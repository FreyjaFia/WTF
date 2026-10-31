namespace WTF.Tests.Endpoints;

/// <summary>
/// A reviewed snapshot of every HTTP route and who may call it. Adding, removing or changing the
/// access rule of a route fails this test, so security changes are always deliberate.
/// </summary>
public class RouteTableTests : IDisposable
{
    private static readonly string[] ExpectedRoutes =
    [
        "GET /api => anonymous",
        "GET /api/audit-logs/ => AuditRead",
        "GET /api/audit-logs/actions => AuditRead",
        "POST /api/auth/change-password => authenticated",
        "POST /api/auth/login => anonymous",
        "POST /api/auth/logout => anonymous",
        "GET /api/auth/me => authenticated",
        "PUT /api/auth/me => authenticated",
        "PUT /api/auth/me/image => authenticated",
        "POST /api/auth/refresh => anonymous",
        "POST /api/auth/validate => anonymous",
        "GET /api/conversations => OrdersRead",
        "GET /api/customers/ => CustomersRead",
        "POST /api/customers/ => CustomersWrite",
        "DELETE /api/customers/{id:guid} => CustomersWrite",
        "GET /api/customers/{id:guid} => CustomersRead",
        "PUT /api/customers/{id:guid} => CustomersWrite",
        "DELETE /api/customers/{id:guid}/image => CustomersWrite",
        "POST /api/customers/{id:guid}/image => CustomersWrite",
        "PUT /api/customers/{id:guid}/ordering-link-access => OrderLinksManage",
        "GET /api/customers/{id:guid}/ordering-links => CustomersRead",
        "POST /api/customers/{id:guid}/ordering-links => OrderLinksManage",
        "DELETE /api/customers/{id:guid}/ordering-links/{linkId:guid} => OrderLinksManage",
        "POST /api/customers/{id:guid}/restore => CustomersWrite",
        "GET /api/dashboard/ => DashboardRead",
        "GET /api/health => anonymous",
        "GET /api/items/ => ItemsRead",
        "GET /api/items/attention => StockMovementsRead",
        "GET /api/items/coverage => ItemsRead",
        "GET /api/items/{id:guid}/alert-recipients => ItemsRead",
        "PUT /api/items/{id:guid}/alert-recipients => ItemsWrite",
        "GET /api/notifications/ => authenticated",
        "GET /api/notifications/counts => authenticated",
        "POST /api/notifications/read => authenticated",
        "POST /api/items/ => ItemsWrite",
        "POST /api/items/product-links => ItemsWrite",
        "DELETE /api/items/{id:guid} => ItemsWrite",
        "GET /api/items/{id:guid} => ItemsRead",
        "PUT /api/items/{id:guid} => ItemsWrite",
        "PUT /api/items/{id:guid}/product-links => ItemsWrite",
        "POST /api/items/{id:guid}/restore => ItemsWrite",
        "POST /api/items/{id:guid}/stock => StockMovementsWrite",
        "POST /api/items/{id:guid}/stock/adjust => StockMovementsWrite",
        "POST /api/items/{id:guid}/stock/waste => StockWasteWrite",
        "GET /api/stock-waste/ => StockMovementsRead",
        "GET /api/stock-waste/pending-count => StockWasteReview",
        "POST /api/stock-waste/{id:guid}/confirm => StockWasteReview",
        "POST /api/stock-waste/{id:guid}/dispute => StockWasteReview",
        "POST /api/stock-waste/{id:guid}/reverse => StockWasteReview",
        "GET /api/waste-reasons/ => WasteReasonsRead",
        "POST /api/waste-reasons/ => WasteReasonsManage",
        "PUT /api/waste-reasons/{id:int} => WasteReasonsManage",
        "POST /api/waste-reasons/{id:int}/deactivate => WasteReasonsManage",
        "POST /api/waste-reasons/{id:int}/restore => WasteReasonsManage",
        "GET /api/items/{id:guid}/movements => StockMovementsRead",
        "POST /api/loyalty/generate/{customerId:guid} => CustomersWrite",
        "GET /api/loyalty/redirect/{token} => anonymous",
        "GET /api/public/order-links/{token}/ => anonymous",
        "GET /api/public/order-links/{token}/conversations => anonymous",
        "GET /api/public/order-links/{token}/orders => anonymous",
        "POST /api/public/order-links/{token}/orders => anonymous",
        "GET /api/public/order-links/{token}/orders/{orderId:guid} => anonymous",
        "GET /api/public/order-links/{token}/orders/{orderId:guid}/messages => anonymous",
        "POST /api/public/order-links/{token}/orders/{orderId:guid}/messages => anonymous",
        "POST /api/public/order-links/{token}/orders/{orderId:guid}/messages/image => anonymous",
        "POST /api/public/order-links/{token}/orders/{orderId:guid}/messages/read => anonymous",
        "GET /api/public/order-links/{token}/orders/{orderId:guid}/messages/{messageId:guid}/image => anonymous",
        "DELETE /api/public/order-links/{token}/orders/{orderId:guid}/messages/{messageId:guid}/image => anonymous",
        "GET /api/loyalty/{customerId:guid} => CustomersRead",
        "GET /api/management/promotions/discounted-products/ => PromotionsRead",
        "POST /api/management/promotions/discounted-products/ => PromotionsRead+PromotionsWrite",
        "DELETE /api/management/promotions/discounted-products/{promotionId:guid} => PromotionsRead+PromotionsWrite",
        "GET /api/management/promotions/discounted-products/{promotionId:guid} => PromotionsRead",
        "PUT /api/management/promotions/discounted-products/{promotionId:guid} => PromotionsRead+PromotionsWrite",
        "GET /api/management/promotions/fixed-bundles/ => PromotionsRead",
        "POST /api/management/promotions/fixed-bundles/ => PromotionsRead+PromotionsWrite",
        "DELETE /api/management/promotions/fixed-bundles/{promotionId:guid} => PromotionsRead+PromotionsWrite",
        "GET /api/management/promotions/fixed-bundles/{promotionId:guid} => PromotionsRead",
        "PUT /api/management/promotions/fixed-bundles/{promotionId:guid} => PromotionsRead+PromotionsWrite",
        "GET /api/management/promotions/mix-match/ => PromotionsRead",
        "POST /api/management/promotions/mix-match/ => PromotionsRead+PromotionsWrite",
        "DELETE /api/management/promotions/mix-match/{promotionId:guid} => PromotionsRead+PromotionsWrite",
        "GET /api/management/promotions/mix-match/{promotionId:guid} => PromotionsRead",
        "PUT /api/management/promotions/mix-match/{promotionId:guid} => PromotionsRead+PromotionsWrite",
        "DELETE /api/management/promotions/{promotionId:guid}/images => PromotionsRead+PromotionsWrite",
        "POST /api/management/promotions/{promotionId:guid}/images => PromotionsRead+PromotionsWrite",
        "POST /api/management/promotions/{promotionId:guid}/restore => PromotionsRead+PromotionsWrite",
        "GET /api/orders/ => OrdersRead",
        "POST /api/orders/ => OrdersWrite",
        "GET /api/orders/active => OrdersRead",
        "POST /api/orders/batch => OrdersWrite",
        "POST /api/orders/sync => OrdersWrite",
        "GET /api/orders/history => OrdersRead",
        "GET /api/orders/paged => OrdersRead",
        "GET /api/orders/{id:guid} => OrdersRead",
        "PUT /api/orders/{id:guid} => OrdersWrite",
        "PUT /api/orders/{id:guid}/override => OrdersOverride",
        "POST /api/orders/{id:guid}/approve => OrdersWrite",
        "POST /api/orders/{id:guid}/ready => OrdersWrite",
        "POST /api/orders/{id:guid}/reject => OrdersWrite",
        "POST /api/orders/{id:guid}/review/approve => OrdersOverride",
        "POST /api/orders/{id:guid}/review/reject => OrdersOverride",
        "GET /api/orders/{id:guid}/conversation => OrdersRead",
        "GET /api/orders/{id:guid}/stock-movements => StockMovementsRead",
        "POST /api/orders/{id:guid}/messages => OrdersWrite",
        "POST /api/orders/{id:guid}/messages/image => OrdersWrite",
        "POST /api/orders/{id:guid}/messages/read => OrdersWrite",
        "DELETE /api/orders/{id:guid}/messages/{messageId:guid}/image => OrdersWrite",
        "GET /api/orders/{id:guid}/messages/{messageId:guid}/image => OrdersRead",
        "PATCH /api/orders/{id:guid}/void => OrdersWrite",
        "GET /api/pos/promotions/discounted-products => OrdersWrite",
        "GET /api/pos/promotions/bundles => OrdersWrite",
        "GET /api/pos/stock-limits => OrdersWrite",
        "GET /api/pos/waste-items => StockWasteWrite",
        "GET /api/products/ => ProductsRead",
        "POST /api/products/ => ProductsWrite",
        "GET /api/products/ingredients => ItemsRead",
        "GET /api/products/addons/{addOnId:guid}/products => ProductsRead",
        "POST /api/products/addons/{addOnId:guid}/products => ProductsWrite",
        "DELETE /api/products/{id:guid} => ProductsWrite",
        "GET /api/products/{id:guid} => ProductsRead",
        "PUT /api/products/{id:guid} => ProductsWrite",
        "GET /api/products/{id:guid}/addon-price-overrides => ProductsRead",
        "POST /api/products/{id:guid}/addon-price-overrides => ProductsWrite",
        "DELETE /api/products/{id:guid}/addon-price-overrides/{addOnId:guid} => ProductsWrite",
        "PUT /api/products/{id:guid}/addon-price-overrides/{addOnId:guid} => ProductsWrite",
        "GET /api/products/{id:guid}/addons => ProductsRead",
        "POST /api/products/{id:guid}/addons => ProductsWrite",
        "DELETE /api/products/{id:guid}/images => ProductsWrite",
        "POST /api/products/{id:guid}/images => ProductsWrite",
        "GET /api/products/{id:guid}/price-history => ProductsRead",
        "GET /api/products/{id:guid}/recipe-cost => InventoryCostsRead",
        "PUT /api/products/{id:guid}/recipe-multiplier => ProductsWrite",
        "PUT /api/products/{id:guid}/supplies-cost => InventoryCostsWrite",
        "POST /api/products/{id:guid}/restore => ProductsWrite",
        "POST /api/push/subscribe => authenticated",
        "POST /api/push/unsubscribe => authenticated",
        "GET /api/reports/category-sales => ReportsRead",
        "GET /api/reports/customer-links => ReportsRead",
        "GET /api/reports/customers => ReportsRead",
        "GET /api/reports/daily-close => ReportsRead",
        "GET /api/reports/daily-sales => ReportsRead",
        "GET /api/reports/hourly => ReportsRead",
        "GET /api/reports/monthly-workbook/download => ReportsRead",
        "POST /api/reports/monthly-workbook/generate => ReportsRead+ReportsGenerate",
        "GET /api/reports/monthly-workbook/status => ReportsRead",
        "GET /api/reports/payments => ReportsRead",
        "GET /api/reports/product-margin => ReportsRead",
        "GET /api/reports/product-sales => ReportsRead",
        "GET /api/reports/promotions => ReportsRead",
        "GET /api/reports/staff => ReportsRead",
        "GET /api/reports/stock-status => ReportsRead",
        "GET /api/reports/voids => ReportsRead",
        "GET /api/reports/waste => ReportsRead",
        "GET /api/schema-script-history/ => SchemaScriptHistoryRead",
        "GET /api/sync/pos-catalog => ProductsRead",
        "GET /api/users/ => UsersRead",
        "POST /api/users/ => UsersWrite",
        "DELETE /api/users/{id:guid} => UsersWrite",
        "GET /api/users/{id:guid} => UsersRead",
        "PUT /api/users/{id:guid} => UsersWrite",
        "DELETE /api/users/{id:guid}/images => UsersWrite",
        "POST /api/users/{id:guid}/images => UsersWrite",
        "POST /api/users/{id:guid}/restore => UsersWrite",
    ];

    private readonly EndpointTestHost _host = new();

    public void Dispose() => _host.Dispose();

    [Fact]
    public void Routes_MatchTheReviewedSnapshot()
    {
        var actual = _host.Routes.Select(r => r.Description).ToList();

        actual.Except(ExpectedRoutes).ShouldBeEmpty("routes added, or whose access changed");
        ExpectedRoutes.Except(actual).ShouldBeEmpty("routes removed, or whose access changed");
        actual.Count.ShouldBe(ExpectedRoutes.Length);
    }

    [Fact]
    public void Routes_HaveNoDuplicateMethodAndPath()
    {
        var duplicates = _host.Routes
            .GroupBy(r => (r.Method, Path: r.Pattern.TrimEnd('/')))
            .Where(g => g.Count() > 1)
            .Select(g => $"{g.Key.Method} {g.Key.Path}");

        duplicates.ShouldBeEmpty();
    }

    [Fact]
    public void Routes_AllLiveUnderApi()
    {
        _host.Routes.ShouldAllBe(r => r.Pattern.StartsWith("/api", StringComparison.Ordinal));
    }

    [Fact]
    public void OnlyTheExpectedRoutesArePublic()
    {
        var anonymous = _host.Routes.Where(r => r.Access == "anonymous").Select(r => $"{r.Method} {r.Pattern}");

        anonymous.OrderBy(x => x, StringComparer.Ordinal).ShouldBe(
        [
            "DELETE /api/public/order-links/{token}/orders/{orderId:guid}/messages/{messageId:guid}/image",
            "GET /api",
            "GET /api/health",
            "GET /api/loyalty/redirect/{token}",
            "GET /api/public/order-links/{token}/",
            "GET /api/public/order-links/{token}/conversations",
            "GET /api/public/order-links/{token}/orders",
            "GET /api/public/order-links/{token}/orders/{orderId:guid}",
            "GET /api/public/order-links/{token}/orders/{orderId:guid}/messages",
            "GET /api/public/order-links/{token}/orders/{orderId:guid}/messages/{messageId:guid}/image",
            "POST /api/auth/login",
            "POST /api/auth/logout",
            "POST /api/auth/refresh",
            "POST /api/auth/validate",
            "POST /api/public/order-links/{token}/orders",
            "POST /api/public/order-links/{token}/orders/{orderId:guid}/messages",
            "POST /api/public/order-links/{token}/orders/{orderId:guid}/messages/image",
            "POST /api/public/order-links/{token}/orders/{orderId:guid}/messages/read",
        ]);
    }

    [Fact]
    public void WriteRoutes_WithoutAPolicy_AreOnlyAuthAndPushRoutes()
    {
        var weak = _host.Routes
            .Where(r => r.Method is "POST" or "PUT" or "PATCH" or "DELETE")
            .Where(r => r.Access is "authenticated" or "anonymous")
            .Select(r => r.Description)
            .OrderBy(x => x, StringComparer.Ordinal);

        // These legitimately need only a login (or none): sign-in flows, own profile, push tokens.
        weak.ShouldBe(
        [
            "DELETE /api/public/order-links/{token}/orders/{orderId:guid}/messages/{messageId:guid}/image => anonymous",
            "POST /api/auth/change-password => authenticated",
            "POST /api/auth/login => anonymous",
            "POST /api/auth/logout => anonymous",
            "POST /api/auth/refresh => anonymous",
            "POST /api/auth/validate => anonymous",
            "POST /api/notifications/read => authenticated",
            "POST /api/public/order-links/{token}/orders => anonymous",
            "POST /api/public/order-links/{token}/orders/{orderId:guid}/messages => anonymous",
            "POST /api/public/order-links/{token}/orders/{orderId:guid}/messages/image => anonymous",
            "POST /api/public/order-links/{token}/orders/{orderId:guid}/messages/read => anonymous",
            "POST /api/push/subscribe => authenticated",
            "POST /api/push/unsubscribe => authenticated",
            "PUT /api/auth/me => authenticated",
            "PUT /api/auth/me/image => authenticated",
        ]);
    }

    [Fact]
    public void EveryPolicyUsedByARoute_IsADefinedAppPolicy()
    {
        var defined = typeof(WTF.Api.Common.Auth.AppPolicies).GetFields()
            .Where(f => f.IsLiteral).Select(f => (string)f.GetRawConstantValue()!).ToHashSet();
        var used = _host.Routes.SelectMany(r => r.Policies).Distinct();

        used.Except(defined).ShouldBeEmpty();
    }
}
