using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using NSubstitute;
using System.Security.Claims;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Common.Tenancy;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Tenancy;

public class LegacyTokenPlanTests
{
    private static async Task<(string Db, Guid UserId)> SeedAsync(string planFeatures)
    {
        var name = TestDb.NewName();
        TestDb.SeedSystemRoles(name);
        var userId = Guid.NewGuid();
        var plan = new Plan { Code = "p", Name = "Plan", MonthlyPrice = 1, Features = planFeatures, IsActive = true, SortOrder = 1 };
        await TestDb.SaveAsync(name, plan);
        await TestDb.SaveAsync(
            name,
            new TenantSubscription
            {
                TenantId = TenantDefaults.DefaultTenantId,
                PlanId = plan.Id,
                CurrentPeriodStart = DateTime.UtcNow.AddDays(-1),
                CurrentPeriodEnd = DateTime.UtcNow.AddDays(30),
                GraceDays = 7,
                UpdatedAt = DateTime.UtcNow,
            },
            new User
            {
                Id = userId,
                Username = "o",
                FirstName = "O",
                LastName = "O",
                PasswordHash = "x",
                IsActive = true,
                RoleId = 4,
                CreatedAt = DateTime.UtcNow,
                CreatedBy = userId,
            });

        return (name, userId);
    }

    private static async Task<ClaimsPrincipal> RunAsync(string dbName, Guid userId, bool legacyTokens, bool withTenantClaim)
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        Claim[] claims = [new(ClaimTypes.NameIdentifier, userId.ToString()), new(ClaimTypes.Role, AppRoles.Owner)];
        if (withTenantClaim)
        {
            claims = [.. claims, new Claim(TenantDefaults.ClaimType, TenantDefaults.DefaultTenantId.ToString())];
        }

        var context = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) };
        accessor.HttpContext.Returns(context);
        var tenant = new CurrentTenant(Options.Create(new TenancyOptions { LegacyTokensAreDefaultTenant = legacyTokens }), accessor);
        context.RequestServices = new ServiceCollection().AddScoped(_ => TestDb.Create(dbName, tenant)).BuildServiceProvider();

        await new PermissionClaimsMiddleware(_ => Task.CompletedTask)
            .InvokeAsync(context, new RolePermissionCache(TimeProvider.System), new TenantFeatureCache(TimeProvider.System));
        return context.User;
    }

    [Fact]
    public async Task ALegacyTokenWithNoTenantClaim_IsGatedByTheFirstShopsPlan()
    {
        var (db, userId) = await SeedAsync(string.Empty);

        var user = await RunAsync(db, userId, legacyTokens: true, withTenantClaim: false);

        user.HasClaim(c => c.Type == PermissionClaimsMiddleware.PlanLoadedClaim).ShouldBeTrue();
        PermissionChecks.Has(user, "orders.read").ShouldBeTrue();
        PermissionChecks.Has(user, "items.read").ShouldBeFalse();
        FeatureAuthorizationHandler.IsInPlan(user, "inventory").ShouldBeFalse();
    }

    [Fact]
    public async Task ALegacyTokenOnAPlanWithInventory_KeepsInventory()
    {
        var (db, userId) = await SeedAsync("inventory");

        var user = await RunAsync(db, userId, legacyTokens: true, withTenantClaim: false);

        PermissionChecks.Has(user, "items.read").ShouldBeTrue();
        FeatureAuthorizationHandler.IsInPlan(user, "inventory").ShouldBeTrue();
    }

    [Fact]
    public async Task ATokenWithNoShopAtAll_GetsTheCoreFeaturesOnly_NotEverything()
    {
        var (db, userId) = await SeedAsync("inventory,promotions");

        var user = await RunAsync(db, userId, legacyTokens: false, withTenantClaim: false);

        user.HasClaim(c => c.Type == PermissionClaimsMiddleware.PlanLoadedClaim).ShouldBeTrue();
        PermissionChecks.Has(user, "items.read").ShouldBeFalse();
        FeatureAuthorizationHandler.IsInPlan(user, "promotions").ShouldBeFalse();
    }

    [Fact]
    public async Task ATokenWithATenantClaim_StillUsesItsPlan()
    {
        var (db, userId) = await SeedAsync(string.Empty);

        var user = await RunAsync(db, userId, legacyTokens: false, withTenantClaim: true);

        PermissionChecks.Has(user, "items.read").ShouldBeFalse();
        PermissionChecks.Has(user, "orders.read").ShouldBeTrue();
    }
}
