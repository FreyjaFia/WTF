using MediatR;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Inventory;

namespace WTF.Api.Endpoints;

public record MarkStockNotificationsReadRequest(List<Guid>? Ids);

public static class StockNotificationEndpoints
{
    public static IEndpointRouteBuilder MapStockNotifications(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/stock-notifications")
            .RequireAuthorization();

        group.MapGet("/",
            async (bool? unreadOnly, int? page, int? pageSize, ISender sender) =>
            {
                var result = await sender.Send(new GetStockNotificationsQuery(unreadOnly ?? false, page ?? 1, pageSize ?? 25));
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.StockMovementsRead);

        group.MapPost("/read",
            async (MarkStockNotificationsReadRequest request, ISender sender) =>
            {
                var unread = await sender.Send(new MarkStockNotificationsReadCommand(request.Ids));
                return Results.Ok(new { unreadCount = unread });
            })
            .RequireAuthorization(AppPolicies.StockMovementsRead);

        return app;
    }
}
