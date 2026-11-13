using Microsoft.AspNetCore.Authorization;
using System.Security.Claims;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Auth.Permissions;
using WTF.Calculations.Subscriptions;

namespace WTF.Tests.Permissions;

public class PlanFeatureTests
{
    [Fact]
    public void Parse_AlwaysHoldsCore_AndIgnoresOldAndUnknownWords()
    {
        PlanFeatures.Parse("pos,orders,reports,offline").Order().ShouldBe(["core"]);
        PlanFeatures.Parse(null).Order().ShouldBe(["core"]);
        PlanFeatures.Parse("pos, Inventory ,promotions;chat\nbogus").Order().ShouldBe(["chat", "core", "inventory", "orderlinks", "promotions"]);
    }

    [Fact]
    public void Effective_KeepsOnlyKeysWhoseFeatureIsInThePlan()
    {
        var starter = PlanFeatures.Parse("pos,orders,reports,offline");
        var pro = PlanFeatures.Parse(string.Join(",", PlanFeatures.Gateable));
        var keys = PermissionCatalog.All.Select(p => p.Key).ToList();

        var onStarter = PlanFeatures.Effective(keys, PermissionCatalog.FeatureOf, starter);
        var onPro = PlanFeatures.Effective(keys, PermissionCatalog.FeatureOf, pro);

        onPro.Count.ShouldBe(keys.Count);
        onStarter.ShouldContain("orders.write");
        onStarter.ShouldContain("users.write");
        onStarter.ShouldNotContain("roles.manage");
        onStarter.ShouldNotContain("expenses.read");
        onStarter.ShouldNotContain("audit.read");
        onStarter.ShouldNotContain("chat.write");
        onStarter.ShouldNotContain("stock.write");
        onStarter.ShouldNotContain("promotions.read");
        onStarter.ShouldNotContain("orderlinks.manage");
        onStarter.ShouldNotContain("reports.generate");
        onStarter.All(k => PermissionCatalog.FeatureOf(k) == "core").ShouldBeTrue();
    }

    [Fact]
    public void EveryCatalogFeature_IsKnownToPlans()
    {
        PermissionCatalog.All.Select(p => p.Feature).Distinct()
            .Except([PlanFeatures.Core]).ShouldBeSubsetOf(PlanFeatures.Gateable);
    }

    [Fact]
    public async Task PermissionOutsideThePlan_IsRefusedAsNotInPlan_EvenForARoleThatHoldsIt()
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity(
        [
            new Claim("perm_resolved", "1"),
            new Claim("perm", "orders.read"),
            new Claim("plan_loaded", "Starter"),
            new Claim("plan_feature", "core")
        ], "test"));
        var handler = new PermissionAuthorizationHandler();

        async Task<AuthorizationHandlerContext> RunAsync(params string[] anyOf)
        {
            var requirement = new PermissionRequirement(anyOf);
            var context = new AuthorizationHandlerContext([requirement], principal, null);
            await handler.HandleAsync(context);
            return context;
        }

        var inPlan = await RunAsync("orders.read");
        inPlan.HasSucceeded.ShouldBeTrue();

        var outside = await RunAsync("stock.read");
        outside.HasSucceeded.ShouldBeFalse();
        outside.FailureReasons.Any(r => r.Message == PermissionAuthorizationHandler.NotInPlanMessage).ShouldBeTrue();

        var either = await RunAsync("stock.read", "orders.read");
        either.HasSucceeded.ShouldBeTrue();
    }

    [Fact]
    public void WithoutPlanClaims_NothingIsBlockedByPlan()
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, AppRoles.Owner)], "test"));

        PermissionAuthorizationHandler.IsOutsidePlan(principal, ["stock.read"]).ShouldBeFalse();
    }
}
