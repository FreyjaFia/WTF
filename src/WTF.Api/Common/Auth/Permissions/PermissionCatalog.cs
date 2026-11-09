namespace WTF.Api.Common.Auth.Permissions;

public static class PermissionCatalog
{
    public static readonly IReadOnlyList<PermissionDefinition> All =
    [
        new("orders.read", "Orders", "View orders", "See the order list, order details and order chat.", "core", []),
        new("orders.write", "Orders", "Take and change orders", "Create, edit, pay and cancel orders; also loads products and customers for the order editor.", "core", ["orders.read"]),
        new("orders.override", "Orders", "Override completed orders", "Change an order that is already completed.", "core", ["orders.write"]),
        new("orderlinks.manage", "Orders", "Manage order links", "Create and cancel customer ordering links.", "orderlinks", []),
        new("customers.read", "Customers", "View customers", "Open the Customers screen and see customer details.", "core", []),
        new("customers.write", "Customers", "Add and edit customers", "Register and change customers (cashiers can register one from the order screen without the Customers screen).", "core", []),
        new("products.read", "Menu", "View products", "Open the Products screen and see the menu setup.", "core", []),
        new("products.write", "Menu", "Add and edit products", "Create and change products, add-ons and categories.", "core", ["products.read"]),
        new("items.read", "Inventory", "View items", "See inventory items.", "inventory", []),
        new("items.write", "Inventory", "Add and edit items", "Create and change inventory items.", "inventory", ["items.read"]),
        new("inventory.costs.read", "Inventory", "View costs", "See item costs, supplier prices and totals.", "inventory", []),
        new("inventory.costs.write", "Inventory", "Change costs", "Change item costs.", "inventory", ["inventory.costs.read"]),
        new("stock.read", "Inventory", "View stock", "See stock movements, counts, reorder lists, purchase orders and receiving.", "inventory", []),
        new("stock.write", "Inventory", "Change stock", "Record movements, counts, purchase orders and receiving.", "inventory", ["stock.read"]),
        new("suppliers.read", "Inventory", "View suppliers", "See the supplier list and what each supplier sells.", "inventory", []),
        new("suppliers.write", "Inventory", "Add and edit suppliers", "Create, change, deactivate and restore suppliers.", "inventory", ["suppliers.read"]),
        new("stock.waste.record", "Inventory", "Record waste", "Record wasted stock.", "inventory", []),
        new("stock.waste.review", "Inventory", "Review waste", "Approve or reject recorded waste.", "inventory", []),
        new("wastereasons.read", "Inventory", "View waste reasons", "See the waste reason list.", "inventory", []),
        new("wastereasons.manage", "Inventory", "Manage waste reasons", "Add and change waste reasons.", "inventory", ["wastereasons.read"]),
        new("expenses.read", "Money", "View expenses", "See expenses.", "core", []),
        new("expenses.write", "Money", "Add and edit expenses", "Create and change expenses.", "core", ["expenses.read"]),
        new("promotions.read", "Promotions", "View promotions", "See promotions.", "promotions", []),
        new("promotions.write", "Promotions", "Add and edit promotions", "Create and change promotions.", "promotions", ["promotions.read"]),
        new("dashboard.read", "Insight", "View the dashboard", "See the live dashboard.", "core", []),
        new("reports.read", "Insight", "View reports", "See sales and stock reports.", "core", []),
        new("reports.generate", "Insight", "Generate reports", "Generate the monthly report workbook.", "workbook", ["reports.read"]),
        new("users.read", "People", "View users", "See the user list.", "core", []),
        new("users.write", "People", "Add and edit users", "Create, change and remove users.", "core", ["users.read"]),
        new("roles.manage", "People", "Manage roles", "Create, change and delete custom roles and choose what each can do. Only permissions you hold yourself can be given.", "core", []),
        new("brand.manage", "Shop", "Manage shop brand", "Change the shop name, logo and receipt details.", "core", []),
        new("subscription.billing", "Shop", "Manage subscription and billing", "See and pay the subscription.", "core", []),
        new("audit.read", "System", "View the audit log", "See who changed what.", "core", []),
        new("schemascripts.read", "System", "View database script history", "See which database scripts have run.", "core", [])
    ];

    public static string FeatureOf(string key) =>
        All.FirstOrDefault(p => p.Key == key)?.Feature ?? "core";

    public static readonly IReadOnlyDictionary<string, string[]> PolicyPermissions = new Dictionary<string, string[]>
    {
        [AppPolicies.SubscriptionBilling] = ["subscription.billing"],
        [AppPolicies.BrandManage] = ["brand.manage"],
        [AppPolicies.ProductsRead] = ["products.read", "orders.write"],
        [AppPolicies.ProductsWrite] = ["products.write"],
        [AppPolicies.UsersRead] = ["users.read"],
        [AppPolicies.UsersWrite] = ["users.write"],
        [AppPolicies.RolesRead] = ["roles.manage", "users.read"],
        [AppPolicies.RolesManage] = ["roles.manage"],
        [AppPolicies.PromotionsRead] = ["promotions.read"],
        [AppPolicies.PromotionsWrite] = ["promotions.write"],
        [AppPolicies.AuditRead] = ["audit.read"],
        [AppPolicies.SchemaScriptHistoryRead] = ["schemascripts.read"],
        [AppPolicies.OrdersRead] = ["orders.read"],
        [AppPolicies.OrdersWrite] = ["orders.write"],
        [AppPolicies.OrdersOverride] = ["orders.override"],
        [AppPolicies.OrderLinksManage] = ["orderlinks.manage"],
        [AppPolicies.CustomersRead] = ["customers.read", "orders.write"],
        [AppPolicies.CustomersWrite] = ["customers.write"],
        [AppPolicies.ItemsRead] = ["items.read"],
        [AppPolicies.ItemsWrite] = ["items.write"],
        [AppPolicies.InventoryCostsRead] = ["inventory.costs.read"],
        [AppPolicies.InventoryCostsWrite] = ["inventory.costs.write"],
        [AppPolicies.StockMovementsRead] = ["stock.read"],
        [AppPolicies.StockMovementsWrite] = ["stock.write"],
        [AppPolicies.SuppliersRead] = ["suppliers.read"],
        [AppPolicies.SuppliersWrite] = ["suppliers.write"],
        [AppPolicies.StockWasteWrite] = ["stock.waste.record"],
        [AppPolicies.StockWasteReview] = ["stock.waste.review"],
        [AppPolicies.WasteReasonsManage] = ["wastereasons.manage"],
        [AppPolicies.WasteReasonsRead] = ["wastereasons.read"],
        [AppPolicies.ExpensesRead] = ["expenses.read"],
        [AppPolicies.ExpensesWrite] = ["expenses.write"],
        [AppPolicies.DashboardRead] = ["dashboard.read"],
        [AppPolicies.ReportsRead] = ["reports.read"],
        [AppPolicies.ReportsGenerate] = ["reports.generate"]
    };
}
