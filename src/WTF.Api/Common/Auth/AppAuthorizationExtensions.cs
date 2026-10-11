using Microsoft.AspNetCore.Authorization;

namespace WTF.Api.Common.Auth;

public static class AppAuthorizationExtensions
{
    /// <summary>Registers one authorization policy per <see cref="AppPolicies"/> entry.</summary>
    public static AuthorizationBuilder AddAppAuthorization(this IServiceCollection services)
    {
        return services.AddAuthorizationBuilder()
            .AddPolicy(AppPolicies.ProductsRead, policy =>
                policy.RequireRole(AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.Cashier))
            .AddPolicy(AppPolicies.ProductsWrite, policy =>
                policy.RequireRole(AppRoles.SuperAdmin, AppRoles.Admin))
            .AddPolicy(AppPolicies.UsersRead, policy =>
                policy.RequireRole(AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer))
            .AddPolicy(AppPolicies.UsersWrite, policy =>
                policy.RequireRole(AppRoles.SuperAdmin, AppRoles.Admin))
            .AddPolicy(AppPolicies.PromotionsRead, policy =>
                policy.RequireRole(AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer))
            .AddPolicy(AppPolicies.PromotionsWrite, policy =>
                policy.RequireRole(AppRoles.SuperAdmin, AppRoles.Admin))
            .AddPolicy(AppPolicies.AuditRead, policy =>
                policy.RequireRole(AppRoles.SuperAdmin))
            .AddPolicy(AppPolicies.SchemaScriptHistoryRead, policy =>
                policy.RequireRole(AppRoles.SuperAdmin))
            .AddPolicy(AppPolicies.OrdersRead, policy =>
                policy.RequireRole(AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.Cashier))
            .AddPolicy(AppPolicies.OrdersWrite, policy =>
                policy.RequireRole(AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.Cashier))
            .AddPolicy(AppPolicies.OrdersOverride, policy =>
                policy.RequireRole(AppRoles.SuperAdmin, AppRoles.Admin))
            .AddPolicy(AppPolicies.CustomersRead, policy =>
                policy.RequireRole(AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.Cashier))
            .AddPolicy(AppPolicies.CustomersWrite, policy =>
                policy.RequireRole(AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.Cashier))
            .AddPolicy(AppPolicies.ItemsRead, policy =>
                policy.RequireRole(AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.ItemManager))
            .AddPolicy(AppPolicies.ItemsWrite, policy =>
                policy.RequireRole(AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.ItemManager))
            .AddPolicy(AppPolicies.StockMovementsRead, policy =>
                policy.RequireRole(AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.StockManager))
            .AddPolicy(AppPolicies.StockMovementsWrite, policy =>
                policy.RequireRole(AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.StockManager))
            .AddPolicy(AppPolicies.DashboardRead, policy =>
                policy.RequireRole(AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer))
            .AddPolicy(AppPolicies.ReportsRead, policy =>
                policy.RequireRole(AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer));
    }
}
