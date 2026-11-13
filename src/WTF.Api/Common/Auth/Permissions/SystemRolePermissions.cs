namespace WTF.Api.Common.Auth.Permissions;

public static class SystemRolePermissions
{
    public static readonly IReadOnlyDictionary<string, string[]> Bundles = new Dictionary<string, string[]>
    {
        [AppRoles.Owner] = [.. PermissionCatalog.All.Select(p => p.Key)],
        [AppRoles.Admin] =
        [
            "orders.read",
            "orders.write",
            "orders.override",
            "orders.seniorpwd.apply",
            "orderlinks.manage",
            "customers.read",
            "customers.write",
            "products.read",
            "products.write",
            "items.read",
            "items.write",
            "inventory.costs.read",
            "inventory.costs.write",
            "stock.read",
            "stock.write",
            "suppliers.read",
            "suppliers.write",
            "stock.waste.record",
            "stock.waste.review",
            "wastereasons.read",
            "wastereasons.manage",
            "expenses.read",
            "expenses.write",
            "promotions.read",
            "promotions.write",
            "dashboard.read",
            "reports.read",
            "reports.generate",
            "users.read",
            "users.write",
            "brand.manage",
            "subscription.billing"
        ],
        [AppRoles.AdminViewer] =
        [
            "orders.read",
            "customers.read",
            "products.read",
            "items.read",
            "inventory.costs.read",
            "stock.read",
            "suppliers.read",
            "wastereasons.read",
            "expenses.read",
            "promotions.read",
            "dashboard.read",
            "reports.read",
            "users.read"
        ],
        [AppRoles.Cashier] =
        [
            "orders.read",
            "orders.write",
            "orders.seniorpwd.apply",
            "orderlinks.manage",
            "customers.write",
            "stock.waste.record",
            "wastereasons.read"
        ],
        [AppRoles.ItemManager] =
        [
            "items.read",
            "items.write"
        ],
        [AppRoles.StockManager] =
        [
            "items.read",
            "stock.read",
            "stock.write",
            "suppliers.read",
            "suppliers.write",
            "stock.waste.record",
            "wastereasons.read"
        ]
    };

    public static string[] RolesWith(string permission) =>
        [.. Bundles.Where(b => b.Value.Contains(permission)).Select(b => b.Key)];
}
