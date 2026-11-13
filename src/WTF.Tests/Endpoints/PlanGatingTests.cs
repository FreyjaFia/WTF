using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using System.Security.Claims;
using System.Text.Json;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Auth.Permissions;
using WTF.Calculations.Subscriptions;

namespace WTF.Tests.Endpoints;

/// <summary>
/// Plan gating at the API door: a route whose permission is core but whose data belongs to a switchable feature, the 403
/// answer, and the safety net that fails when a route is added without a plan decision.
/// </summary>
public class PlanGatingTests : IDisposable
{
    private static readonly string[] Public = ["/api/public/", "/api/loyalty/"];

    // Routes that need no plan decision: sign-in and the signed-in person's own shop screens that every plan has, and
    // the offline sync, which is never gated.
    private static readonly string[] AllowedWithoutFeature =
    [
        "GET /api",
        "GET /api/health",
        "GET /api/notifications/",
        "GET /api/notifications/counts",
        "POST /api/notifications/read",
        "GET /api/subscription/",
        "GET /api/settings/brand/",
        "POST /api/orders/sync",
        "POST /api/orders/batch",
        "GET /api/sync/pos-catalog"
    ];

    private readonly EndpointTestHost _host = new();

    public void Dispose() => _host.Dispose();

    private static ClaimsPrincipal ShopUser(string planName, IEnumerable<string> features, IEnumerable<string>? permissions = null)
    {
        var claims = new List<Claim>
        {
            new(PermissionClaimsMiddleware.ResolvedClaim, "1"),
            new(PermissionClaimsMiddleware.PlanLoadedClaim, planName)
        };
        claims.AddRange(features.Append(PlanFeatures.Core).Select(f => new Claim(PermissionClaimsMiddleware.PlanFeatureClaim, f)));
        claims.AddRange((permissions ?? PermissionCatalog.All.Select(p => p.Key)).Select(k => new Claim(PermissionClaimsMiddleware.PermissionClaim, k)));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, "test"));
    }

    private static ClaimsPrincipal OnPlan(string features, string name) =>
        ShopUser(name, PlanFeatures.Parse(features), PermissionCatalog.All.Select(p => p.Key));

    private async Task<bool> IsAllowedAsync(string policy, ClaimsPrincipal user)
    {
        var authorization = _host.App.Services.GetRequiredService<IAuthorizationService>();
        return (await authorization.AuthorizeAsync(user, null, policy)).Succeeded;
    }

    private static bool PermissionPolicyHasKnownFeature(string policy) =>
        PermissionCatalog.PolicyPermissions.TryGetValue(policy, out var keys)
        && keys.All(k => PermissionCatalog.All.Any(p => p.Key == k)
            && (PermissionCatalog.FeatureOf(k) == PlanFeatures.Core || PlanFeatures.IsKnown(PermissionCatalog.FeatureOf(k))));

    [Fact]
    public void EveryRoute_HasAPlanDecision()
    {
        var undecided = _host.Routes
            .Where(r => !r.AllowsAnonymous)
            .Where(r => !Public.Any(p => r.Pattern.StartsWith(p, StringComparison.Ordinal)))
            .Where(r => !r.Pattern.StartsWith("/api/platform", StringComparison.Ordinal))
            .Where(r => !r.Pattern.StartsWith("/api/auth", StringComparison.Ordinal))
            .Where(r => !r.Pattern.StartsWith("/api/push", StringComparison.Ordinal))
            .Where(r => !AllowedWithoutFeature.Contains($"{r.Method} {r.Pattern}"))
            .Where(r => !r.Policies.Any(p => p.StartsWith(AppPolicies.FeaturePrefix, StringComparison.Ordinal))
                        && !r.Policies.Any(PermissionPolicyHasKnownFeature))
            .Select(r => r.Description)
            .ToList();

        undecided.ShouldBeEmpty("a route needs a permission with a known feature, RequireFeature, or a place on the allow-list");
    }

    [Fact]
    public void EveryFeaturePolicy_NamesAFeatureInTheCatalog()
    {
        var used = _host.Routes.SelectMany(r => r.Policies)
            .Where(p => p.StartsWith(AppPolicies.FeaturePrefix, StringComparison.Ordinal))
            .Select(p => p[AppPolicies.FeaturePrefix.Length..])
            .Distinct();

        used.ShouldAllBe(f => PlanFeatures.IsKnown(f));
    }

    [Theory]
    [InlineData("inventory")]
    [InlineData("promotions")]
    [InlineData("orderlinks")]
    public async Task FeaturePolicy_IsRefusedOnStarter_AllowedOnProAndBusiness_AndOnAShopWithoutPlanInfo(string feature)
    {
        var policy = AppPolicies.RequireFeature(feature);
        var starter = OnPlan(string.Empty, "Starter");
        var pro = OnPlan("inventory,promotions,orderlinks", "Pro");
        var business = OnPlan(string.Join(",", PlanFeatures.Gateable), "Business");
        var noPlanInfo = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, AppRoles.Owner)], "test"));

        (await IsAllowedAsync(policy, starter)).ShouldBeFalse();
        (await IsAllowedAsync(policy, pro)).ShouldBeTrue();
        (await IsAllowedAsync(policy, business)).ShouldBeTrue();
        (await IsAllowedAsync(policy, noPlanInfo)).ShouldBeTrue();
    }

    [Fact]
    public async Task EveryMixedRoute_IsRefusedOnStarterEvenForAnOwner_AndAllowedOnBusiness()
    {
        var starter = OnPlan(string.Empty, "Starter");
        var business = OnPlan(string.Join(",", PlanFeatures.Gateable), "Business");
        var mixed = _host.Routes.Where(r => r.Policies.Any(p => p.StartsWith(AppPolicies.FeaturePrefix, StringComparison.Ordinal))).ToList();

        mixed.Count.ShouldBeGreaterThanOrEqualTo(8);
        foreach (var route in mixed)
        {
            foreach (var policy in route.Policies)
            {
                (await IsAllowedAsync(policy, business)).ShouldBeTrue($"{route.Description} on Business");
            }

            var refusedAnywhere = false;
            foreach (var policy in route.Policies)
            {
                refusedAnywhere |= !await IsAllowedAsync(policy, starter);
            }

            refusedAnywhere.ShouldBeTrue($"{route.Description} on Starter");
        }
    }

    [Fact]
    public async Task OfflineSync_IsNotGatedByAnyPlan()
    {
        var starter = OnPlan(string.Empty, "Starter");
        var sync = _host.Routes.Where(r => r.Pattern is "/api/orders/sync" or "/api/orders/batch").ToList();

        sync.Count.ShouldBe(2);
        foreach (var route in sync)
        {
            route.Policies.ShouldNotContain(p => p.StartsWith(AppPolicies.FeaturePrefix, StringComparison.Ordinal));
            foreach (var policy in route.Policies)
            {
                (await IsAllowedAsync(policy, starter)).ShouldBeTrue(route.Description);
            }
        }
    }

    [Fact]
    public async Task APermissionOutsideThePlan_AndAFeaturePolicy_BothAnswer403NotInPlan()
    {
        var handler = new PlanAwareAuthorizationResultHandler();
        var authorization = _host.App.Services.GetRequiredService<IAuthorizationService>();
        var starter = OnPlan(string.Empty, "Starter");

        foreach (var policy in new[] { AppPolicies.RequireFeature("inventory"), AppPolicies.ItemsRead, AppPolicies.ChatRead, AppPolicies.PurchasingRead })
        {
            var result = await authorization.AuthorizeAsync(starter, null, policy);
            result.Succeeded.ShouldBeFalse(policy);

            var context = new DefaultHttpContext();
            context.Response.Body = new MemoryStream();
            var authorizationPolicy = new AuthorizationPolicyBuilder().RequireAssertion(_ => false).Build();
            await handler.HandleAsync(_ => Task.CompletedTask, context, authorizationPolicy, PolicyAuthorizationResult.Forbid(result.Failure));

            context.Response.StatusCode.ShouldBe(403, policy);
            context.Response.Body.Position = 0;
            using var body = await JsonDocument.ParseAsync(context.Response.Body);
            body.RootElement.GetProperty("code").GetString().ShouldBe("not_in_plan", policy);
        }
    }

    [Fact]
    public void TheNewKeys_FollowTheirFeatures()
    {
        PermissionCatalog.FeatureOf("purchasing.read").ShouldBe("purchasing");
        PermissionCatalog.FeatureOf("suppliers.write").ShouldBe("purchasing");
        PermissionCatalog.FeatureOf("chat.write").ShouldBe("chat");
        PermissionCatalog.FeatureOf("expenses.read").ShouldBe("expenses");
        PermissionCatalog.FeatureOf("audit.read").ShouldBe("audit");
        PermissionCatalog.FeatureOf("roles.manage").ShouldBe("customroles");
    }
}
