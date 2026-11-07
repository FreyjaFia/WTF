using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using NSubstitute;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Auth;
using WTF.Api.Features.Conversations;
using WTF.Api.Features.Loyalty;
using WTF.Api.Features.OrderLinks;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Tenancy;

// Two shops in one database: what a login, a public link, a hub group, a stored file and a promotion gate may reach.
public class TenantPhase2Tests
{
    private static readonly Guid TenantA = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
    private static readonly Guid TenantB = Guid.Parse("bbbbbbbb-0000-0000-0000-000000000002");

    private readonly string _dbName = TestDb.NewName();

    private static CurrentTenant NewAnonymousMultiTenant()
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns(new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity()) });
        return new CurrentTenant(Options.Create(new TenancyOptions { Mode = "Multi" }), accessor);
    }

    private static CurrentTenant NewSignedInTenant(Guid tenantId)
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        var identity = new ClaimsIdentity([new Claim(TenantDefaults.ClaimType, tenantId.ToString())], "test");
        accessor.HttpContext.Returns(new DefaultHttpContext { User = new ClaimsPrincipal(identity) });
        return new CurrentTenant(Options.Create(new TenancyOptions { Mode = "Multi" }), accessor);
    }

    private WTFDbContext Anonymous(out CurrentTenant tenant)
    {
        tenant = NewAnonymousMultiTenant();
        return TestDb.Create(_dbName, tenant);
    }

    private async Task SeedUsersAsync()
    {
        await using var db = TestDb.Create(_dbName);
        db.UserRoles.Add(new UserRole { Id = 1, Name = "Admin" });
        foreach (var (tenant, username) in new[] { (TenantA, "alice"), (TenantB, "bob") })
        {
            db.Users.Add(new User
            {
                Id = Guid.NewGuid(),
                TenantId = tenant,
                Username = username,
                FirstName = username,
                LastName = "Owner",
                PasswordHash = BCrypt.Net.BCrypt.HashPassword("S3cret-pass"),
                IsActive = true,
                RoleId = 1,
                CreatedAt = DateTime.UtcNow,
            });
        }

        await db.SaveChangesAsync();
    }

    private static IConfiguration JwtConfig() => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["Jwt:SecretKey"] = "unit-test-secret-key-that-is-long-enough-for-hmac-sha256",
        ["Jwt:Issuer"] = "wtf-tests",
        ["Jwt:Audience"] = "wtf-clients",
    }).Build();

    [Fact]
    public async Task Login_FindsTheUserInTheirOwnTenant_AndPutsThatTenantInTheToken()
    {
        await SeedUsersAsync();
        var db = Anonymous(out var tenant);
        var config = JwtConfig();
        var handler = new LoginHandler(db, new JwtService(config, TestRequest.None()), new UserRoleService(db), config, TestFakes.Audit());

        var result = await handler.Handle(new LoginCommand("bob", "S3cret-pass"), CancellationToken.None);

        result.ShouldNotBeNull();
        new JwtSecurityTokenHandler().ReadJwtToken(result.AccessToken).Claims
            .Single(c => c.Type == TenantDefaults.ClaimType).Value.ShouldBe(TenantB.ToString());
        tenant.TenantId.ShouldBe(TenantB);

        await using var read = TestDb.Create(_dbName);
        (await read.RefreshTokens.SingleAsync()).TenantId.ShouldBe(TenantB);
    }

    [Fact]
    public async Task Refresh_KeepsTheTenantOfTheRefreshToken()
    {
        await SeedUsersAsync();
        var config = JwtConfig();

        var loginDb = Anonymous(out _);
        var login = await new LoginHandler(loginDb, new JwtService(config, TestRequest.None()), new UserRoleService(loginDb), config, TestFakes.Audit())
            .Handle(new LoginCommand("alice", "S3cret-pass"), CancellationToken.None);

        var refreshDb = Anonymous(out var refreshTenant);
        var refreshed = await new RefreshTokenHandler(refreshDb, new JwtService(config, TestRequest.None()), new UserRoleService(refreshDb), config)
            .Handle(new RefreshTokenCommand(login.RefreshToken), CancellationToken.None);

        refreshed.ShouldNotBeNull();
        new JwtSecurityTokenHandler().ReadJwtToken(refreshed.AccessToken).Claims
            .Single(c => c.Type == TenantDefaults.ClaimType).Value.ShouldBe(TenantA.ToString());
        refreshTenant.TenantId.ShouldBe(TenantA);
    }

    [Fact]
    public async Task SignedInTenantA_CannotUseTenantBsRefreshToken()
    {
        await SeedUsersAsync();
        await using (var seed = TestDb.Create(_dbName))
        {
            var bob = await seed.Users.IgnoreQueryFilters().SingleAsync(u => u.Username == "bob");
            seed.RefreshTokens.Add(new RefreshToken { UserId = bob.Id, TenantId = TenantB, Token = "bob-token", ExpiresAt = DateTime.UtcNow.AddDays(1), CreatedAt = DateTime.UtcNow });
            await seed.SaveChangesAsync();
        }

        await using var read = TestDb.Create(_dbName, NewSignedInTenant(TenantA));

        (await read.RefreshTokens.CountAsync()).ShouldBe(0);
        (await read.Users.Select(u => u.Username).ToListAsync()).ShouldBe(["alice"]);
    }

    [Fact]
    public async Task PublicLink_TakesItsTenantFromTheLinkRow_AndOnlySeesThatTenantsCustomer()
    {
        var customerA = Guid.NewGuid();
        var customerB = Guid.NewGuid();
        var userId = Guid.NewGuid();
        await using (var seed = TestDb.Create(_dbName))
        {
            seed.UserRoles.Add(new UserRole { Id = 1, Name = "Admin" });
            seed.Users.Add(new User { Id = userId, TenantId = TenantA, Username = "owner", FirstName = "O", LastName = "W", PasswordHash = "x", RoleId = 1, IsActive = true, CreatedAt = DateTime.UtcNow });
            seed.Customers.AddRange(
                new Customer { Id = customerA, TenantId = TenantA, FirstName = "Ann", LastName = "A", IsActive = true, AllowOrderingLink = true, CreatedAt = DateTime.UtcNow, CreatedBy = userId },
                new Customer { Id = customerB, TenantId = TenantB, FirstName = "Ben", LastName = "B", IsActive = true, AllowOrderingLink = true, CreatedAt = DateTime.UtcNow, CreatedBy = userId });
            seed.ShortLinks.AddRange(
                new ShortLink { Id = Guid.NewGuid(), TenantId = TenantA, Token = "token-a", TargetType = OrderLinkToken.TargetType, TargetId = customerA, CreatedAt = DateTime.UtcNow, CreatedBy = userId },
                new ShortLink { Id = Guid.NewGuid(), TenantId = TenantB, Token = "token-b", TargetType = OrderLinkToken.TargetType, TargetId = customerB, CreatedAt = DateTime.UtcNow, CreatedBy = userId });
            await seed.SaveChangesAsync();
        }

        var db = Anonymous(out var tenant);
        tenant.TenantId.ShouldBeNull();

        var access = await OrderLinkAccess.ResolveAsync(db, "token-b", CancellationToken.None);

        access.ShouldNotBeNull();
        access.Customer.FirstName.ShouldBe("Ben");
        tenant.TenantId.ShouldBe(TenantB);
        (await db.Customers.Select(c => c.FirstName).ToListAsync()).ShouldBe(["Ben"]);
    }

    [Fact]
    public async Task PublicLink_UnknownToken_SetsNoTenantAndSeesNothing()
    {
        var db = Anonymous(out var tenant);

        (await OrderLinkAccess.ResolveAsync(db, "nope", CancellationToken.None)).ShouldBeNull();

        tenant.TenantId.ShouldBeNull();
        (await db.Customers.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task LoyaltyRedirect_ResolvesATokenOfAnyTenant_ButNotAnOrderLinkToken()
    {
        await using (var seed = TestDb.Create(_dbName))
        {
            seed.UserRoles.Add(new UserRole { Id = 1, Name = "Admin" });
            var userId = Guid.NewGuid();
            seed.Users.Add(new User { Id = userId, TenantId = TenantB, Username = "owner", FirstName = "O", LastName = "W", PasswordHash = "x", RoleId = 1, IsActive = true, CreatedAt = DateTime.UtcNow });
            seed.ShortLinks.AddRange(
                new ShortLink { Id = Guid.NewGuid(), TenantId = TenantB, Token = "loyal", TargetType = "Loyalty", TargetId = Guid.Parse("11111111-1111-1111-1111-111111111111"), CreatedAt = DateTime.UtcNow, CreatedBy = userId },
                new ShortLink { Id = Guid.NewGuid(), TenantId = TenantB, Token = "order", TargetType = OrderLinkToken.TargetType, TargetId = Guid.NewGuid(), CreatedAt = DateTime.UtcNow, CreatedBy = userId });
            await seed.SaveChangesAsync();
        }

        var db = Anonymous(out _);
        var handler = new RedirectToLoyaltyHandler(db);

        (await handler.Handle(new RedirectToLoyaltyQuery("loyal"), CancellationToken.None)).CustomerId
            .ShouldBe(Guid.Parse("11111111-1111-1111-1111-111111111111"));
        (await handler.Handle(new RedirectToLoyaltyQuery("order"), CancellationToken.None)).CustomerId.ShouldBeNull();
    }

    [Fact]
    public async Task OrderNumbers_AreNotAllocatedInMemory_AndStayWhateverTheCallerSet()
    {
        var tenant = NewSignedInTenant(TenantA);
        await using var db = TestDb.Create(_dbName, tenant);
        var userId = Guid.NewGuid();
        db.Orders.Add(new Order { Id = Guid.NewGuid(), OrderNumber = 7, CreatedBy = userId, StatusId = 1, CreatedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();

        (await db.Orders.SingleAsync()).OrderNumber.ShouldBe(7);
    }

    [Fact]
    public void HubGroups_AreSeparatePerTenant_AndDefaultToTheFirstTenant()
    {
        HubNames.Groups.DashboardViewers(TenantA).ShouldNotBe(HubNames.Groups.DashboardViewers(TenantB));
        HubNames.Groups.StaffOrders(TenantA).ShouldNotBe(HubNames.Groups.StaffOrders(TenantB));
        HubNames.Groups.StockViewers(TenantA).ShouldNotBe(HubNames.Groups.StockViewers(TenantB));
        HubNames.Groups.DashboardViewers(null).ShouldBe(HubNames.Groups.DashboardViewers(Guid.Empty));
        HubNames.Groups.DashboardViewers(null).ShouldBe(HubNames.Groups.DashboardViewers(TenantDefaults.DefaultTenantId));
    }

    [Fact]
    public void HubGroup_OfASignedInUser_ComesFromTheTokenClaim()
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(TenantDefaults.ClaimType, TenantB.ToString())], "test"));

        HubNames.Groups.TenantOf(principal).ShouldBe(TenantB);
        HubNames.Groups.TenantOf(new ClaimsPrincipal(new ClaimsIdentity())).ShouldBeNull();
    }

    [Fact]
    public async Task PromotionLimitGate_OfOneTenant_DoesNotBlockAnother()
    {
        using var first = await PromotionLimitGate.EnterAsync(TenantA, CancellationToken.None);

        using var other = await PromotionLimitGate.EnterAsync(TenantB, new CancellationTokenSource(TimeSpan.FromSeconds(2)).Token);

        other.ShouldNotBeNull();

        var sameTenant = PromotionLimitGate.EnterAsync(TenantA, new CancellationTokenSource(TimeSpan.FromMilliseconds(150)).Token);
        await Should.ThrowAsync<OperationCanceledException>(() => sameTenant);
    }

    [Fact]
    public async Task ImageStorage_KeepsEachTenantsFilesApart()
    {
        var inner = new FakeImageStorage();
        var storageA = new TenantImageStorage(inner, NewSignedInTenant(TenantA));
        var storageB = new TenantImageStorage(inner, NewSignedInTenant(TenantB));

        var urlA = await storageA.SaveAsync("products", "a.png", [1], CancellationToken.None);
        var urlB = await storageB.SaveAsync("products", "b.png", [2], CancellationToken.None);

        urlA.ShouldContain(TenantA.ToString("N"));
        (await storageA.ListAsync(CancellationToken.None)).Select(f => f.Url).ShouldBe([urlA]);
        (await storageB.ListAsync(CancellationToken.None)).Select(f => f.Url).ShouldBe([urlB]);

        await storageA.DeleteAsync(urlB, CancellationToken.None);
        inner.Files.ShouldContain(inner.GetKey(urlB));

        await storageB.DeleteAsync(urlB, CancellationToken.None);
        inner.Files.ShouldNotContain(inner.GetKey(urlB));
    }

    [Fact]
    public async Task ImageStorage_OldFilesWithoutATenantFolder_BelongToTheFirstTenantOnly()
    {
        var inner = new FakeImageStorage();
        inner.Files.Add("images/products/old.png");
        var first = new TenantImageStorage(inner, NewSignedInTenant(TenantDefaults.DefaultTenantId));
        var other = new TenantImageStorage(inner, NewSignedInTenant(TenantA));

        (await first.ListAsync(CancellationToken.None)).Select(f => f.Key).ShouldBe(["images/products/old.png"]);
        (await other.ListAsync(CancellationToken.None)).ShouldBeEmpty();

        await other.DeleteAsync("/images/products/old.png", CancellationToken.None);
        inner.Files.ShouldContain("images/products/old.png");
    }

    [Fact]
    public void StripTenant_RemovesTheTenantFolderSoCategorySettingsStillMatch()
    {
        TenantStorage.StripTenant($"images/{TenantA:N}/users/a.png", "images/").ShouldBe("images/users/a.png");
        TenantStorage.StripTenant("images/users/a.png", "images/").ShouldBe("images/users/a.png");
    }

    [Fact]
    public async Task ReportStorage_TenantAFileIsNotVisibleToTenantB_AndOldFilesBelongToTheFirstTenant()
    {
        var inner = new FakeReportStorage();
        var storageA = new TenantReportFileStorage(inner, NewSignedInTenant(TenantA));
        var storageB = new TenantReportFileStorage(inner, NewSignedInTenant(TenantB));
        var first = new TenantReportFileStorage(inner, NewSignedInTenant(TenantDefaults.DefaultTenantId));

        await storageA.SaveAsync("reports/jan.xlsx", [1, 2], "x", null, CancellationToken.None);
        inner.Files["reports/legacy.xlsx"] = [9];

        (await storageA.ReadAllBytesAsync("reports/jan.xlsx", CancellationToken.None)).ShouldBe([1, 2]);
        (await storageB.ReadAllBytesAsync("reports/jan.xlsx", CancellationToken.None)).ShouldBeNull();
        (await storageB.GetInfoAsync("reports/jan.xlsx", CancellationToken.None)).ShouldBeNull();
        (await storageB.ReadAllBytesAsync("reports/legacy.xlsx", CancellationToken.None)).ShouldBeNull();
        (await first.ReadAllBytesAsync("reports/legacy.xlsx", CancellationToken.None)).ShouldBe([9]);
        (await first.GetInfoAsync("reports/legacy.xlsx", CancellationToken.None))!.RelativePath.ShouldBe("reports/legacy.xlsx");
    }

    [Fact]
    public async Task ChatImageStore_TenantBCannotReadOrDeleteTenantAsPicture()
    {
        var inner = new FakeChatImageStore();
        var storeA = new TenantChatImageStore(inner, NewSignedInTenant(TenantA));
        var storeB = new TenantChatImageStore(inner, NewSignedInTenant(TenantB));

        await storeA.SaveAsync("c/1.jpg", [5], "image/jpeg", CancellationToken.None);

        (await storeA.ReadAsync("c/1.jpg", CancellationToken.None)).ShouldBe([5]);
        (await storeB.ReadAsync("c/1.jpg", CancellationToken.None)).ShouldBeNull();

        await storeB.DeleteAsync("c/1.jpg", CancellationToken.None);
        (await storeA.ReadAsync("c/1.jpg", CancellationToken.None)).ShouldBe([5]);
    }

    private sealed class FakeImageStorage : IImageStorage
    {
        public HashSet<string> Files { get; } = new(StringComparer.OrdinalIgnoreCase);

        public Task<string> SaveAsync(string category, string fileName, byte[] data, CancellationToken cancellationToken)
        {
            var key = $"images/{category}/{fileName}";
            Files.Add(key);
            return Task.FromResult("/" + key);
        }

        public Task DeleteAsync(string? imageUrl, CancellationToken cancellationToken)
        {
            Files.Remove(GetKey(imageUrl!));
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<StoredImageInfo>> ListAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<StoredImageInfo>>(Files.Select(k => new StoredImageInfo(k, "/" + k, DateTimeOffset.UtcNow)).ToList());

        public string GetKey(string imageUrl) => imageUrl.TrimStart('/');
    }

    private sealed class FakeReportStorage : IReportFileStorage
    {
        public Dictionary<string, byte[]> Files { get; } = [];

        public Task SaveAsync(string relativePath, byte[] data, string contentType, DateTimeOffset? generatedAtUtc, CancellationToken cancellationToken)
        {
            Files[relativePath] = data;
            return Task.CompletedTask;
        }

        public Task<byte[]?> ReadAllBytesAsync(string relativePath, CancellationToken cancellationToken) =>
            Task.FromResult(Files.GetValueOrDefault(relativePath));

        public Task<ReportFileInfo?> GetInfoAsync(string relativePath, CancellationToken cancellationToken) =>
            Task.FromResult(Files.TryGetValue(relativePath, out var data)
                ? new ReportFileInfo(relativePath, data.Length, DateTimeOffset.UtcNow)
                : null);
    }

    private sealed class FakeChatImageStore : IChatImageStore
    {
        public Dictionary<string, byte[]> Files { get; } = [];

        public Task SaveAsync(string key, byte[] data, string contentType, CancellationToken cancellationToken)
        {
            Files[key] = data;
            return Task.CompletedTask;
        }

        public Task<byte[]?> ReadAsync(string key, CancellationToken cancellationToken) =>
            Task.FromResult(Files.GetValueOrDefault(key));

        public Task DeleteAsync(string key, CancellationToken cancellationToken)
        {
            Files.Remove(key);
            return Task.CompletedTask;
        }
    }
}

public class TenantSchedulerTests
{
    private static readonly Guid TenantA = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
    private static readonly Guid TenantB = Guid.Parse("bbbbbbbb-0000-0000-0000-000000000002");
    private static readonly Guid Suspended = Guid.Parse("cccccccc-0000-0000-0000-000000000003");

    private sealed class RecordingScheduler(IServiceScopeFactory scopeFactory, List<Guid?> ran, HashSet<Guid> failFor)
        : DailyCatchUpScheduler(scopeFactory, Substitute.For<Microsoft.Extensions.Logging.ILogger>())
    {
        protected override string JobName => "test";
        protected override bool IsEnabled => true;
        protected override string TimeZoneId => "UTC";
        protected override int RunAtHour => 0;
        protected override int RunAtMinute => 0;
        protected override int RetryCount => 0;
        protected override int RetryDelayMinutes => 1;

        protected override Task<DateTimeOffset?> GetLastRunUtcAsync(IServiceProvider services, CancellationToken cancellationToken) =>
            Task.FromResult<DateTimeOffset?>(null);

        protected override Task RunJobAsync(IServiceProvider services, CancellationToken cancellationToken)
        {
            var tenant = services.GetRequiredService<ICurrentTenant>().StampTenantId;
            lock (ran)
            {
                ran.Add(tenant);
            }

            if (tenant is { } id && failFor.Contains(id))
            {
                throw new InvalidOperationException("boom");
            }

            return Task.CompletedTask;
        }
    }

    [Fact]
    public async Task MultiMode_RunsOncePerActiveTenant_AndOneFailureDoesNotStopTheOthers()
    {
        var name = TestDb.NewName();
        await using (var seed = TestDb.Create(name))
        {
            seed.Tenants.AddRange(
                new Tenant { Id = TenantA, Name = "A", Slug = "a", Status = TenantStatus.Active },
                new Tenant { Id = TenantB, Name = "B", Slug = "b", Status = TenantStatus.Trial },
                new Tenant { Id = Suspended, Name = "S", Slug = "s", Status = TenantStatus.Suspended });
            await seed.SaveChangesAsync();
        }

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IHttpContextAccessor>(new HttpContextAccessor());
        services.AddSingleton(Options.Create(new TenancyOptions { Mode = "Multi" }));
        services.AddScoped<ICurrentTenant, CurrentTenant>();
        services.AddScoped(sp => TestDb.Create(name, sp.GetRequiredService<ICurrentTenant>()));
        var provider = services.BuildServiceProvider();

        var ran = new List<Guid?>();
        var scheduler = new RecordingScheduler(provider.GetRequiredService<IServiceScopeFactory>(), ran, [TenantA]);

        await scheduler.StartAsync(CancellationToken.None);
        await Task.Delay(800);
        await scheduler.StopAsync(CancellationToken.None);

        ran.Distinct().OrderBy(x => x).ToList().ShouldBe([TenantA, TenantB]);
    }

    [Fact]
    public async Task SingleMode_RunsOnceForTheFirstTenant()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IHttpContextAccessor>(new HttpContextAccessor());
        services.AddSingleton(Options.Create(new TenancyOptions()));
        services.AddScoped<ICurrentTenant, CurrentTenant>();
        var provider = services.BuildServiceProvider();

        var ran = new List<Guid?>();
        var scheduler = new RecordingScheduler(provider.GetRequiredService<IServiceScopeFactory>(), ran, []);

        await scheduler.StartAsync(CancellationToken.None);
        await Task.Delay(500);
        await scheduler.StopAsync(CancellationToken.None);

        ran.Distinct().ShouldBe([TenantDefaults.DefaultTenantId]);
    }
}
