using System.Text.Json;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Auth.Permissions;
using WTF.Calculations.Subscriptions;

namespace WTF.Tests.Permissions;

public class PermissionCatalogTests
{
    private sealed record SharedCatalog(
        List<SharedPermission> Catalog,
        Dictionary<string, string[]> SystemRoles,
        Dictionary<string, string[]> Policies);

    private sealed record SharedPermission(string Key, string Area, string Label, string Description, string Feature, string[] Requires);

    private static readonly string[] Features = [PlanFeatures.Core, .. PlanFeatures.Gateable];

    private static readonly string[] ShopRoles =
        [AppRoles.Owner, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.Cashier, AppRoles.ItemManager, AppRoles.StockManager];

    private static readonly Lazy<SharedCatalog> Shared = new(() =>
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Permissions", "permission-catalog.json");
        return JsonSerializer.Deserialize<SharedCatalog>(
            File.ReadAllText(path),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
    });

    [Fact]
    public void Keys_AreUniqueAndLowerCase()
    {
        var keys = PermissionCatalog.All.Select(p => p.Key).ToList();

        keys.Distinct().Count().ShouldBe(keys.Count);
        keys.ShouldAllBe(k => k == k.ToLowerInvariant());
    }

    [Fact]
    public void EveryPermission_HasLabelAreaAndKnownFeature()
    {
        foreach (var p in PermissionCatalog.All)
        {
            p.Label.ShouldNotBeNullOrWhiteSpace();
            p.Area.ShouldNotBeNullOrWhiteSpace();
            Features.ShouldContain(p.Feature, p.Key);
        }
    }

    [Fact]
    public void RequiredKeys_ExistInTheCatalog()
    {
        var keys = PermissionCatalog.All.Select(p => p.Key).ToHashSet();

        foreach (var p in PermissionCatalog.All)
        {
            keys.IsSupersetOf(p.Requires).ShouldBeTrue(p.Key);
        }
    }

    [Theory]
    [InlineData(AppRoles.Owner)]
    [InlineData(AppRoles.Admin)]
    [InlineData(AppRoles.AdminViewer)]
    [InlineData(AppRoles.Cashier)]
    [InlineData(AppRoles.ItemManager)]
    [InlineData(AppRoles.StockManager)]
    public void SystemRole_OnlyHoldsCatalogKeys_AndEveryKeyHasItsRequiredKeys(string role)
    {
        var bundle = SystemRolePermissions.Bundles[role].ToHashSet();
        var catalog = PermissionCatalog.All.ToDictionary(p => p.Key);

        bundle.ShouldAllBe(k => catalog.ContainsKey(k));
        foreach (var key in bundle)
        {
            bundle.IsSupersetOf(catalog[key].Requires).ShouldBeTrue($"{role} holds {key} without what it requires");
        }
    }

    [Fact]
    public void Owner_HoldsEveryPermission()
    {
        SystemRolePermissions.Bundles[AppRoles.Owner].OrderBy(k => k)
            .ShouldBe(PermissionCatalog.All.Select(p => p.Key).OrderBy(k => k));
    }

    [Fact]
    public void SystemRoles_AreTheSixShopRoles()
    {
        SystemRolePermissions.Bundles.Keys.OrderBy(k => k).ShouldBe(ShopRoles.OrderBy(k => k));
    }

    [Fact]
    public void EveryPolicyExceptPlatformAdmin_IsMappedToExistingKeys()
    {
        var policies = typeof(AppPolicies).GetFields().Where(f => f.IsLiteral).Select(f => (string)f.GetRawConstantValue()!)
            .Where(p => p != AppPolicies.PlatformAdmin);
        var keys = PermissionCatalog.All.Select(p => p.Key).ToHashSet();

        PermissionCatalog.PolicyPermissions.Keys.OrderBy(k => k).ShouldBe(policies.OrderBy(k => k));
        foreach (var (policy, permissions) in PermissionCatalog.PolicyPermissions)
        {
            permissions.ShouldNotBeEmpty(policy);
            keys.IsSupersetOf(permissions).ShouldBeTrue(policy);
        }
    }

    [Fact]
    public void RecipientLists_MatchTheRoleListsTheyReplaced()
    {
        SystemRolePermissions.RolesWith("stock.write").OrderBy(r => r)
            .ShouldBe(new[] { AppRoles.Owner, AppRoles.Admin, AppRoles.StockManager }.OrderBy(r => r));
        SystemRolePermissions.RolesWith("stock.read").OrderBy(r => r)
            .ShouldBe(new[] { AppRoles.Owner, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.StockManager }.OrderBy(r => r));
        SystemRolePermissions.RolesWith("suppliers.read").OrderBy(r => r)
            .ShouldBe(new[] { AppRoles.Owner, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.StockManager }.OrderBy(r => r));
        SystemRolePermissions.RolesWith("suppliers.write").OrderBy(r => r)
            .ShouldBe(new[] { AppRoles.Owner, AppRoles.Admin, AppRoles.StockManager }.OrderBy(r => r));
        SystemRolePermissions.RolesWith("stock.waste.review").OrderBy(r => r)
            .ShouldBe(new[] { AppRoles.Owner, AppRoles.Admin }.OrderBy(r => r));
        SystemRolePermissions.RolesWith("subscription.billing").OrderBy(r => r)
            .ShouldBe(new[] { AppRoles.Owner, AppRoles.Admin }.OrderBy(r => r));
        SystemRolePermissions.RolesWith(CostAccess.Permission).OrderBy(r => r)
            .ShouldBe(new[] { AppRoles.Owner, AppRoles.Admin, AppRoles.AdminViewer }.OrderBy(r => r));
    }

    [Fact]
    public void SeniorPwdApply_IsHeldByCashiersAdminsAndOwners_NotByViewers()
    {
        SystemRolePermissions.RolesWith("orders.seniorpwd.apply").OrderBy(r => r)
            .ShouldBe(new[] { AppRoles.Owner, AppRoles.Admin, AppRoles.Cashier }.OrderBy(r => r));
        PermissionCatalog.All.Single(p => p.Key == "orders.seniorpwd.apply").Requires.ShouldBe(["orders.write"]);
    }

    [Fact]
    public void SharedFile_MatchesTheCSharpCatalog()
    {
        var shared = Shared.Value;

        shared.Catalog.Select(p => (p.Key, p.Area, p.Label, p.Description, p.Feature, Requires: string.Join(",", p.Requires)))
            .ShouldBe(PermissionCatalog.All.Select(p => (p.Key, p.Area, p.Label, p.Description, p.Feature, Requires: string.Join(",", p.Requires))));
    }

    [Fact]
    public void SharedFile_MatchesTheSystemRoleBundles()
    {
        var shared = Shared.Value;

        shared.SystemRoles.Keys.OrderBy(k => k).ShouldBe(SystemRolePermissions.Bundles.Keys.OrderBy(k => k));
        foreach (var (role, keys) in shared.SystemRoles)
        {
            keys.OrderBy(k => k).ShouldBe(SystemRolePermissions.Bundles[role].OrderBy(k => k), role);
        }
    }

    [Fact]
    public void SharedFile_MatchesThePolicyMap()
    {
        var shared = Shared.Value;

        shared.Policies.Keys.OrderBy(k => k).ShouldBe(PermissionCatalog.PolicyPermissions.Keys.OrderBy(k => k));
        foreach (var (policy, keys) in shared.Policies)
        {
            keys.ShouldBe(PermissionCatalog.PolicyPermissions[policy], policy);
        }
    }
}
