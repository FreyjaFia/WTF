using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using System.Security.Claims;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Auth;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

public class UserSeatBlockDatabaseTests
{
    private const int OwnerRoleId = 4;
    private const int CashierRoleId = 2;

    private static readonly FixedTenant Shop = new(TenantDefaults.DefaultTenantId);

    private static async Task SeedPlanAsync(SqlTestDatabase database, int? maxUsers)
    {
        await using var db = database.CreateContext();
        var plan = new Plan { Code = "capped", Name = "Capped", MonthlyPrice = 1, Features = "reports", MaxUsers = maxUsers, IsActive = true, SortOrder = 1 };
        db.Plans.Add(plan);
        await db.SaveChangesAsync();
        db.TenantSubscriptions.Add(new TenantSubscription
        {
            TenantId = TenantDefaults.DefaultTenantId,
            PlanId = plan.Id,
            CurrentPeriodStart = DateTime.UtcNow.AddDays(-5),
            CurrentPeriodEnd = DateTime.UtcNow.AddDays(300),
            GraceDays = 7,
            UpdatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    private static async Task SetCapAsync(SqlTestDatabase database, int? maxUsers)
    {
        await using var db = database.CreateContext();
        (await db.Plans.SingleAsync()).MaxUsers = maxUsers;
        await db.SaveChangesAsync();
    }

    private static async Task<(Guid Owner, Guid Old, Guid Newer, Guid Newest)> SeedTeamAsync(SqlTestDatabase database)
    {
        await using var db = database.CreateContext();
        var hash = BCrypt.Net.BCrypt.HashPassword("S3cret-pass");
        var start = DateTime.UtcNow.AddDays(-10);
        var ids = new[] { Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid() };
        var names = new[] { "owner", "old", "newer", "newest" };
        for (var i = 0; i < ids.Length; i++)
        {
            db.Users.Add(new User
            {
                Id = ids[i],
                Username = names[i],
                PasswordHash = hash,
                FirstName = "A",
                LastName = "B",
                IsActive = true,
                RoleId = i == 0 ? OwnerRoleId : CashierRoleId,
                CreatedAt = start.AddDays(i),
                CreatedBy = ids[0],
            });
        }

        await db.SaveChangesAsync();
        return (ids[0], ids[1], ids[2], ids[3]);
    }

    private static LoginHandler Login(WTFDbContext db)
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Jwt:SecretKey"] = "unit-test-secret-key-that-is-long-enough-for-hmac-sha256",
            ["Jwt:Issuer"] = "wtf-tests",
            ["Jwt:Audience"] = "wtf-clients",
        }).Build();
        return new LoginHandler(db, new JwtService(cfg, TestRequest.None()), new UserRoleService(db), cfg, TestFakes.Audit());
    }

    private static async Task<HttpContext> RequestAsync(SqlTestDatabase database, Guid userId, string role, RolePermissionCache cache)
    {
        var db = database.CreateContext(Shop);
        var context = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId.ToString()), new Claim(ClaimTypes.Role, role)], "test")),
            RequestServices = new ServiceCollection().AddSingleton(db).BuildServiceProvider(),
        };
        context.Response.Body = new MemoryStream();

        var reached = false;
        await new PermissionClaimsMiddleware(_ =>
        {
            reached = true;
            return Task.CompletedTask;
        }).InvokeAsync(context, cache, new UncachedTenantFeatures());
        context.Items["reached"] = reached;
        return context;
    }

    [SqlFact]
    public async Task Login_OfTheNewestUserPastTheCap_IsRefusedWithTheBlockedCode_AndOlderUsersCanSignIn()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SeedPlanAsync(database, 3);
        await SeedTeamAsync(database);

        await using var db = database.CreateContext();
        var ex = await Should.ThrowAsync<ForbiddenActionException>(() => Login(db).Handle(new LoginCommand("newest", "S3cret-pass"), CancellationToken.None));
        ex.Code.ShouldBe(UserSeatLookup.UserBlockedCode);

        (await Login(db).Handle(new LoginCommand("newer", "S3cret-pass"), CancellationToken.None)).ShouldNotBeNull();
        (await Login(db).Handle(new LoginCommand("owner", "S3cret-pass"), CancellationToken.None)).ShouldNotBeNull();
    }

    [SqlFact]
    public async Task Login_AfterAnUpgradeOrADeactivation_RestoresAccess()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SeedPlanAsync(database, 2);
        await SeedTeamAsync(database);

        await using (var db = database.CreateContext())
        {
            await Should.ThrowAsync<ForbiddenActionException>(() => Login(db).Handle(new LoginCommand("newer", "S3cret-pass"), CancellationToken.None));
        }

        await SetCapAsync(database, null);

        await using var after = database.CreateContext();
        (await Login(after).Handle(new LoginCommand("newest", "S3cret-pass"), CancellationToken.None)).ShouldNotBeNull();
    }

    [SqlFact]
    public async Task Request_OfABlockedUser_Gets403WithTheCode_AndNeverReachesTheApp_UntilTheShopUpgrades()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SeedPlanAsync(database, 3);
        var team = await SeedTeamAsync(database);
        var cache = new RolePermissionCache(TimeProvider.System);

        var blocked = await RequestAsync(database, team.Newest, AppRoles.Cashier, cache);
        blocked.Response.StatusCode.ShouldBe(StatusCodes.Status403Forbidden);
        blocked.Items["reached"].ShouldBe(false);
        blocked.Response.Body.Position = 0;
        (await new StreamReader(blocked.Response.Body).ReadToEndAsync()).ShouldContain(UserSeatLookup.UserBlockedCode);

        var kept = await RequestAsync(database, team.Newer, AppRoles.Cashier, cache);
        kept.Items["reached"].ShouldBe(true);

        await SetCapAsync(database, null);

        var restored = await RequestAsync(database, team.Newest, AppRoles.Cashier, cache);
        restored.Items["reached"].ShouldBe(true);
        restored.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
    }

    [SqlFact]
    public async Task Request_OfTheOwner_IsNeverBlocked_EvenWhenTheCapIsBelowTheOwnerCount()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SeedPlanAsync(database, 1);
        var team = await SeedTeamAsync(database);

        var context = await RequestAsync(database, team.Owner, AppRoles.Owner, new RolePermissionCache(TimeProvider.System));

        context.Items["reached"].ShouldBe(true);
    }
}
