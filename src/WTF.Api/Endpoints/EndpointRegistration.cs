namespace WTF.Api.Endpoints;

public static class EndpointRegistration
{
    /// <summary>Maps every HTTP API endpoint (the SignalR hub and SPA fallback stay in Program.cs).</summary>
    public static IEndpointRouteBuilder MapAppEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api", () => "Welcome to the WTF API!");
        app.MapAuth()
            .MapLoyalty()
            .MapProducts()
            .MapOrders()
            .MapConversations()
            .MapCustomers()
            .MapOrderLinks()
            .MapPublicOrderLinks()
            .MapUsers()
            .MapDashboard()
            .MapPushNotifications()
            .MapReports()
            .MapSync()
            .MapPromotions()
            .MapItems()
            .MapStockWaste()
            .MapNotifications()
            .MapAudit()
            .MapSchemaScriptHistory()
            .MapPing();

        return app;
    }
}
