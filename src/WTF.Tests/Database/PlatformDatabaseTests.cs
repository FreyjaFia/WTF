using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using NSubstitute;
using System.IO.Compression;
using System.Security.Claims;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Conversations;
using WTF.Api.Features.Platform;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

/// <summary>The platform area (shops created, suspended, exported, deleted) against a real SQL Server.</summary>
public class PlatformDatabaseTests
{
    private const string AdminPassword = "correct horse battery";

    private static IConfiguration Config() => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["Jwt:SecretKey"] = "unit-test-secret-key-that-is-long-enough-for-hmac-sha256",
        ["Jwt:Issuer"] = "wtf-tests",
        ["Jwt:Audience"] = "wtf-clients",
    }).Build();

    private static WTFDbContext PlatformContext(SqlTestDatabase database) => database.CreateContext(new SwitchableTenant());

    private static async Task<PlatformAdmin> SeedAdminAsync(SqlTestDatabase database, string username = "boss")
    {
        await using var db = database.CreateContext();
        var admin = new PlatformAdmin
        {
            Username = username,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(AdminPassword),
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
        };
        db.PlatformAdmins.Add(admin);
        await db.SaveChangesAsync();
        return admin;
    }

    private static IPlatformAuditService Audit(WTFDbContext db) => new PlatformAuditService(db, TestRequest.None());

    private static async Task<CreatedTenantDto> CreateShopAsync(SqlTestDatabase database, string slug, string owner)
    {
        await using var db = PlatformContext(database);
        return await new CreateTenantHandler(db, Audit(db)).Handle(
            new CreateTenantCommand("Shop " + slug, slug, "Own", "Er", owner), CancellationToken.None);
    }

    [SqlFact]
    public async Task CreateTenant_MakesTheOwnerAndTheSystemUser_InsideTheNewShop()
    {
        await using var database = await SqlTestDatabase.CreateAsync();

        var created = await CreateShopAsync(database, "moonbrew", "moon.owner");

        created.TemporaryPassword.Length.ShouldBe(TemporaryPassword.Length);
        await using var all = database.CreateContext();
        var users = await all.Users.Where(u => u.TenantId == created.Tenant.Id).OrderBy(u => u.Username).ToListAsync();
        users.Select(u => u.Username).ShouldBe(["customer-link.moonbrew", "moon.owner"]);

        var owner = users.Single(u => u.Username == "moon.owner");
        owner.RoleId.ShouldBe(4);
        owner.IsActive.ShouldBeTrue();
        owner.MustChangePassword.ShouldBeTrue();
        BCrypt.Net.BCrypt.Verify(created.TemporaryPassword, owner.PasswordHash).ShouldBeTrue();
        users.Single(u => u.Username == "customer-link.moonbrew").IsActive.ShouldBeFalse();
        (await all.PlatformAuditLogs.CountAsync(l => l.Action == PlatformActions.TenantCreated)).ShouldBe(1);
    }

    [SqlFact]
    public async Task CreateTenant_RefusesATakenAddressAndAUsernameUsedByAnotherShop()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await CreateShopAsync(database, "moonbrew", "moon.owner");

        await Should.ThrowAsync<InvalidOperationException>(() => CreateShopAsync(database, "moonbrew", "other.owner"));
        await Should.ThrowAsync<InvalidOperationException>(() => CreateShopAsync(database, "sunbrew", "MOON.owner"));
        await Should.ThrowAsync<InvalidOperationException>(() => CreateShopAsync(database, "Bad Slug!", "x.owner"));
        await Should.ThrowAsync<InvalidOperationException>(() => CreateShopAsync(database, "admin", "y.owner"));
    }

    [SqlFact]
    public async Task SuspendedShop_CannotSignIn_AndResumingLetsItBack()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var created = await CreateShopAsync(database, "moonbrew", "moon.owner");
        var cache = new TenantStatusCache(TimeProvider.System);

        await using (var db = PlatformContext(database))
        {
            await new SetTenantStatusHandler(db, Audit(db), cache)
                .Handle(new SetTenantStatusCommand(created.Tenant.Id, TenantStatusChange.Suspend, "unpaid"), CancellationToken.None);
        }

        async Task<object?> SignInAsync()
        {
            await using var db = PlatformContext(database);
            var cfg = Config();
            var login = new LoginHandlerFactory(db, cfg).Create();
            return await login.Handle(new WTF.Api.Features.Auth.LoginCommand("moon.owner", created.TemporaryPassword), CancellationToken.None);
        }

        var ex = await Should.ThrowAsync<InvalidOperationException>(SignInAsync);
        ex.Message.ShouldBe(TenantAccess.SuspendedMessage);

        await using (var db = PlatformContext(database))
        {
            await new SetTenantStatusHandler(db, Audit(db), cache)
                .Handle(new SetTenantStatusCommand(created.Tenant.Id, TenantStatusChange.Resume), CancellationToken.None);
        }

        (await SignInAsync()).ShouldNotBeNull();
    }

    [SqlFact]
    public async Task PlatformLogin_LocksAfterFiveWrongPasswords_AndNeverIssuesATenantToken()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SeedAdminAsync(database);

        async Task<WTF.Api.Features.Auth.DTOs.LoginDto?> TryAsync(string password)
        {
            await using var db = database.CreateContext();
            return await new PlatformLoginHandler(db, new JwtService(Config(), TestRequest.None()), Audit(db), Config(), TimeProvider.System)
                .Handle(new PlatformLoginCommand("boss", password), CancellationToken.None);
        }

        for (var i = 0; i < PlatformLoginHandler.MaxFailedAttempts; i++)
        {
            (await TryAsync("wrong")).ShouldBeNull();
        }

        // Locked: even the right password is refused.
        (await TryAsync(AdminPassword)).ShouldBeNull();

        await using var check = database.CreateContext();
        (await check.PlatformAdmins.SingleAsync()).LockedUntil.ShouldNotBeNull();
        (await check.PlatformAuditLogs.CountAsync(l => l.Action == PlatformActions.LoginLocked)).ShouldBe(1);
    }

    [SqlFact]
    public async Task PlatformLogin_IssuesATokenWithOnlyThePlatformRole()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SeedAdminAsync(database);

        await using var db = database.CreateContext();
        var jwt = new JwtService(Config(), TestRequest.None());
        var result = await new PlatformLoginHandler(db, jwt, Audit(db), Config(), TimeProvider.System)
            .Handle(new PlatformLoginCommand("boss", AdminPassword), CancellationToken.None);

        result.ShouldNotBeNull();
        var principal = jwt.ValidateToken(result.AccessToken)!;
        principal.IsInRole(AppRoles.PlatformAdmin).ShouldBeTrue();
        principal.FindFirst(TenantDefaults.ClaimType).ShouldBeNull();
    }

    [SqlFact]
    public async Task Export_ContainsTheShopsRows_WithoutPasswordsOrOtherShops()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var a = await CreateShopAsync(database, "shopa", "a.owner");
        await CreateShopAsync(database, "shopb", "b.owner");

        await using var db = PlatformContext(database);
        var export = await new ExportTenantHandler(db, Audit(db)).Handle(new ExportTenantQuery(a.Tenant.Id), CancellationToken.None);

        using var zip = new ZipArchive(new MemoryStream(export.Content));
        var usersEntry = zip.GetEntry("Users.json").ShouldNotBeNull();
        using var reader = new StreamReader(usersEntry.Open());
        var json = await reader.ReadToEndAsync();
        json.ShouldContain("a.owner");
        json.ShouldNotContain("b.owner");
        json.ShouldNotContain("PasswordHash");
        zip.GetEntry("RefreshTokens.json").ShouldBeNull();
        zip.GetEntry("tenant.json").ShouldNotBeNull();
    }

    [SqlFact]
    public async Task Delete_RemovesEverythingOfTheShop_KeepsOthers_AndLeavesATombstone()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var admin = await SeedAdminAsync(database);
        var doomed = await CreateShopAsync(database, "doomed", "doomed.owner");
        var kept = await CreateShopAsync(database, "kept", "kept.owner");
        await SeedCustomerAndOrderAsync(database, doomed.Tenant.Id);
        await SeedCustomerAndOrderAsync(database, kept.Tenant.Id);

        await using (var db = PlatformContext(database))
        {
            await Suspend(db, doomed.Tenant.Id);
        }

        await using (var db = PlatformContext(database))
        {
            var preview = await new GetDeletionPreviewHandler(db).Handle(new GetDeletionPreviewQuery(doomed.Tenant.Id), CancellationToken.None);
            preview.RowCounts["Users"].ShouldBe(2);
            preview.RowCounts["Orders"].ShouldBe(1);
        }

        await using (var db = PlatformContext(database))
        {
            await Delete(db, admin, doomed.Tenant.Id, "doomed", AdminPassword);
        }

        await using var all = database.CreateContext();
        (await all.Users.CountAsync(u => u.TenantId == doomed.Tenant.Id)).ShouldBe(0);
        (await all.Orders.CountAsync(o => o.TenantId == doomed.Tenant.Id)).ShouldBe(0);
        (await all.Customers.CountAsync(c => c.TenantId == doomed.Tenant.Id)).ShouldBe(0);
        (await all.Tenants.AnyAsync(t => t.Id == doomed.Tenant.Id)).ShouldBeFalse();
        (await all.Users.CountAsync(u => u.TenantId == kept.Tenant.Id)).ShouldBe(2);
        (await all.Orders.CountAsync(o => o.TenantId == kept.Tenant.Id)).ShouldBe(1);
        var tombstone = await all.TenantTombstones.SingleAsync();
        tombstone.Slug.ShouldBe("doomed");
        tombstone.DeletedBy.ShouldBe("boss");

        // The address cannot be taken again.
        await Should.ThrowAsync<InvalidOperationException>(() => CreateShopAsync(database, "doomed", "again.owner"));
    }

    [SqlFact]
    public async Task Delete_IsRefusedForAnActiveShop_AWrongAddress_AWrongPassword_AndTheFirstShop()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var admin = await SeedAdminAsync(database);
        var shop = await CreateShopAsync(database, "cafe", "cafe.owner");

        await using (var db = PlatformContext(database))
        {
            await Should.ThrowAsync<InvalidOperationException>(() => Delete(db, admin, shop.Tenant.Id, "cafe", AdminPassword));
        }

        await using (var db = PlatformContext(database))
        {
            await Suspend(db, shop.Tenant.Id);
        }

        await using (var db = PlatformContext(database))
        {
            await Should.ThrowAsync<InvalidOperationException>(() => Delete(db, admin, shop.Tenant.Id, "wrong", AdminPassword));
        }

        await using (var db = PlatformContext(database))
        {
            await Should.ThrowAsync<InvalidOperationException>(() => Delete(db, admin, shop.Tenant.Id, "cafe", "nope"));
        }

        await using (var seed = database.CreateContext())
        {
            if (!await seed.Tenants.AnyAsync(t => t.Id == TenantDefaults.DefaultTenantId))
            {
                seed.Tenants.Add(new Tenant { Id = TenantDefaults.DefaultTenantId, Name = "First", Slug = "first", Status = TenantAccess.Suspended, CreatedAt = DateTime.UtcNow });
                await seed.SaveChangesAsync();
            }
        }

        await using (var db = PlatformContext(database))
        {
            var ex = await Should.ThrowAsync<InvalidOperationException>(() => Delete(db, admin, TenantDefaults.DefaultTenantId, "first", AdminPassword));
            ex.Message.ShouldContain("first shop");
        }

        await using var all = database.CreateContext();
        (await all.Users.CountAsync(u => u.TenantId == shop.Tenant.Id)).ShouldBe(2);
    }

    [SqlFact]
    public async Task ResetPassword_GivesANewOneTimePassword_EndsSessions_AndRefusesTheSystemUser()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var created = await CreateShopAsync(database, "cafe", "cafe.owner");

        Guid ownerId;
        await using (var all = database.CreateContext())
        {
            ownerId = await all.Users.Where(u => u.Username == "cafe.owner").Select(u => u.Id).SingleAsync();
            all.RefreshTokens.Add(new RefreshToken { UserId = ownerId, Token = "t", ExpiresAt = DateTime.UtcNow.AddDays(1), CreatedAt = DateTime.UtcNow, TenantId = created.Tenant.Id });
            await all.SaveChangesAsync();
        }

        PasswordResetDto reset;
        await using (var db = PlatformContext(database))
        {
            reset = await new ResetTenantUserPasswordHandler(db, Audit(db))
                .Handle(new ResetTenantUserPasswordCommand(created.Tenant.Id, ownerId), CancellationToken.None);
        }

        reset.TemporaryPassword.ShouldNotBe(created.TemporaryPassword);
        await using var check = database.CreateContext();
        var owner = await check.Users.SingleAsync(u => u.Id == ownerId);
        BCrypt.Net.BCrypt.Verify(reset.TemporaryPassword, owner.PasswordHash).ShouldBeTrue();
        owner.MustChangePassword.ShouldBeTrue();
        (await check.RefreshTokens.SingleAsync(t => t.UserId == ownerId)).IsRevoked.ShouldBeTrue();
        (await check.PlatformAuditLogs.Where(l => l.Action == PlatformActions.PasswordReset).Select(l => l.Details).SingleAsync())
            .ShouldNotContain(reset.TemporaryPassword);

        var systemId = await check.Users.Where(u => u.Username == "customer-link.cafe").Select(u => u.Id).SingleAsync();
        await using var db2 = PlatformContext(database);
        await Should.ThrowAsync<InvalidOperationException>(() => new ResetTenantUserPasswordHandler(db2, Audit(db2))
            .Handle(new ResetTenantUserPasswordCommand(created.Tenant.Id, systemId), CancellationToken.None));
    }

    [SqlFact]
    public async Task Impersonate_NeedsAReason_AFlagOfReadOnly_AndTheTokenCarriesWhoIsBehindIt()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var admin = await SeedAdminAsync(database);
        var created = await CreateShopAsync(database, "cafe", "cafe.owner");
        Guid ownerId;
        await using (var all = database.CreateContext())
        {
            ownerId = await all.Users.Where(u => u.Username == "cafe.owner").Select(u => u.Id).SingleAsync();
        }

        await using var db = PlatformContext(database);
        var jwt = new JwtService(Config(), TestRequest.None());
        var handler = new ImpersonateHandler(db, jwt, Audit(db), AdminAccessor(admin), TimeProvider.System);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            handler.Handle(new ImpersonateCommand(created.Tenant.Id, ownerId, "no"), CancellationToken.None));

        var result = await handler.Handle(new ImpersonateCommand(created.Tenant.Id, ownerId, "Customer asked for help"), CancellationToken.None);

        result.ReadOnly.ShouldBeTrue();
        var principal = jwt.ValidateToken(result.AccessToken)!;
        principal.FindFirst(ImpersonationClaims.By)!.Value.ShouldBe(admin.Id.ToString());
        principal.FindFirst(ImpersonationClaims.ReadOnly)!.Value.ShouldBe("1");
        principal.FindFirst(TenantDefaults.ClaimType)!.Value.ShouldBe(created.Tenant.Id.ToString());
        principal.IsInRole(AppRoles.SuperAdmin).ShouldBeTrue();

        await using var check = database.CreateContext();
        (await check.PlatformAuditLogs.Where(l => l.Action == PlatformActions.ImpersonationStarted).Select(l => l.Details).SingleAsync())
            .ShouldContain("Customer asked for help");
    }

    private static IHttpContextAccessor AdminAccessor(PlatformAdmin admin)
    {
        var identity = new ClaimsIdentity(
        [
            new Claim(ClaimTypes.NameIdentifier, admin.Id.ToString()),
            new Claim(ClaimTypes.Name, admin.Username),
            new Claim(ClaimTypes.Role, AppRoles.PlatformAdmin),
        ], "test");
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns(new DefaultHttpContext { User = new ClaimsPrincipal(identity) });
        return accessor;
    }

    private static Task Suspend(WTFDbContext db, Guid tenantId) =>
        new SetTenantStatusHandler(db, Audit(db), new TenantStatusCache(TimeProvider.System))
            .Handle(new SetTenantStatusCommand(tenantId, TenantStatusChange.Suspend), CancellationToken.None);

    private static Task Delete(WTFDbContext db, PlatformAdmin admin, Guid tenantId, string slug, string password)
    {
        var images = Substitute.For<IImageStorage>();
        images.ListAsync(Arg.Any<CancellationToken>()).Returns([]);
        var options = Options.Create(new TenancyOptions { Mode = TenancyOptions.MultiMode });
        return new DeleteTenantHandler(
                db,
                Audit(db),
                new TenantStatusCache(TimeProvider.System),
                options,
                AdminAccessor(admin),
                images,
                Substitute.For<IChatImageStore>(),
                NullLogger<DeleteTenantHandler>.Instance)
            .Handle(new DeleteTenantCommand(tenantId, slug, password), CancellationToken.None);
    }

    private static async Task SeedCustomerAndOrderAsync(SqlTestDatabase database, Guid tenantId)
    {
        await using var db = database.CreateContext(new FixedTenant(tenantId));
        var userId = await db.Users.Select(u => u.Id).FirstAsync();
        db.Customers.Add(new Customer
        {
            Id = Guid.NewGuid(),
            FirstName = "C",
            LastName = "One",
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId,
        });
        db.Orders.Add(new Order { Id = Guid.NewGuid(), StatusId = 1, CreatedAt = DateTime.UtcNow, CreatedBy = userId });
        await db.SaveChangesAsync();
    }

    private sealed class LoginHandlerFactory(WTFDbContext db, IConfiguration cfg)
    {
        public WTF.Api.Features.Auth.LoginHandler Create() =>
            new(db, new JwtService(cfg, TestRequest.None()), new UserRoleService(db), cfg, TestFakes.Audit());
    }

    private sealed class SwitchableTenant : ICurrentTenant, ITenantSwitch
    {
        private Guid? _id;

        public bool FilterEnabled => true;

        public Guid? TenantId => _id;

        public Guid? StampTenantId => _id;

        public void Use(Guid tenantId) => _id = tenantId;
    }

    private sealed class FixedTenant(Guid id) : ICurrentTenant
    {
        public bool FilterEnabled => true;

        public Guid? TenantId => id;

        public Guid? StampTenantId => id;
    }
}
