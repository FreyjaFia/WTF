using WTF.Calculations.Subscriptions;

namespace WTF.Api.Common.Auth;

public static class AppPolicies
{
    internal const string FeaturePrefix = "Feature:";
    public const string PlatformAdmin = "PlatformAdmin";
    public const string SubscriptionBilling = "SubscriptionBilling";
    public const string BrandManage = "BrandManage";
    public const string ProductsRead = "ProductsRead";
    public const string ProductsWrite = "ProductsWrite";
    public const string UsersRead = "UsersRead";
    public const string UsersWrite = "UsersWrite";
    public const string RolesRead = "RolesRead";
    public const string RolesManage = "RolesManage";
    public const string PromotionsRead = "PromotionsRead";
    public const string PromotionsWrite = "PromotionsWrite";
    public const string AuditRead = "AuditRead";
    public const string SchemaScriptHistoryRead = "SchemaScriptHistoryRead";
    public const string OrdersRead = "OrdersRead";
    public const string OrdersWrite = "OrdersWrite";
    public const string OrdersOverride = "OrdersOverride";
    public const string OrderLinksManage = "OrderLinksManage";
    public const string CustomersRead = "CustomersRead";
    public const string CustomersWrite = "CustomersWrite";
    public const string ItemsRead = "ItemsRead";
    public const string ItemsWrite = "ItemsWrite";
    public const string InventoryCostsRead = "InventoryCostsRead";
    public const string InventoryCostsWrite = "InventoryCostsWrite";
    public const string StockMovementsRead = "StockMovementsRead";
    public const string StockMovementsWrite = "StockMovementsWrite";
    public const string ChatRead = "ChatRead";
    public const string ChatWrite = "ChatWrite";
    public const string PurchasingRead = "PurchasingRead";
    public const string PurchasingWrite = "PurchasingWrite";
    public const string SuppliersRead = "SuppliersRead";
    public const string SuppliersWrite = "SuppliersWrite";
    public const string StockWasteWrite = "StockWasteWrite";
    public const string StockWasteReview = "StockWasteReview";
    public const string WasteReasonsManage = "WasteReasonsManage";
    public const string WasteReasonsRead = "WasteReasonsRead";
    public const string BranchesRead = "BranchesRead";
    public const string BranchesManage = "BranchesManage";
    public const string ExpensesRead = "ExpensesRead";
    public const string ExpensesWrite = "ExpensesWrite";
    public const string DashboardRead = "DashboardRead";
    public const string ReportsRead = "ReportsRead";
    public const string ReportsGenerate = "ReportsGenerate";
    public const string SeniorPwdApply = "SeniorPwdApply";

    public static string RequireFeature(string feature)
    {
        if (!PlanFeatures.IsKnown(feature))
        {
            throw new ArgumentException($"\"{feature}\" is not a plan feature.", nameof(feature));
        }

        return FeaturePrefix + feature;
    }
}
