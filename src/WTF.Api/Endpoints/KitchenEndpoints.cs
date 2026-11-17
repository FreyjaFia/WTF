using MediatR;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Kitchen;
using WTF.Api.Features.Orders.Enums;
using WTF.Calculations.Kitchen;

namespace WTF.Api.Endpoints;

public record MoveKitchenOrderRequest(KitchenState To, KitchenState? From = null, bool BringBack = false);

public static class KitchenEndpoints
{
    public static IEndpointRouteBuilder MapKitchen(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/kitchen")
            .RequireAuthorization();

        // GET /api/kitchen/orders - The orders to make (no prices, no payment data)
        group.MapGet("/orders",
            async (string? states, OrderSourceEnum? source, string? search, ISender sender) =>
            {
                var result = await sender.Send(new GetKitchenBoardQuery(states, source, search));
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.KitchenRead);

        // POST /api/kitchen/orders/{id}/state - Move an order to another kitchen step
        group.MapPost("/orders/{id:guid}/state",
            async (Guid id, MoveKitchenOrderRequest request, ISender sender) =>
            {
                var result = await sender.Send(new MoveKitchenOrderCommand(id, request.To, request.From, request.BringBack));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.KitchenUpdate);

        // POST /api/kitchen/orders/{id}/seen - The kitchen has read the CHANGED / ADDED note
        group.MapPost("/orders/{id:guid}/seen",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new MarkKitchenChangeSeenCommand(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.KitchenUpdate);

        // POST /api/kitchen/orders/{id}/dismiss - Take a "cancelled, stop making" card off the board
        group.MapPost("/orders/{id:guid}/dismiss",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new DismissKitchenOrderCommand(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.KitchenUpdate);

        // POST /api/kitchen/orders/clear-old - Mark the orders from earlier days as served
        group.MapPost("/orders/clear-old",
            async (ISender sender) =>
            {
                var cleared = await sender.Send(new ClearOldKitchenOrdersCommand());
                return Results.Ok(new { cleared });
            })
            .RequireAuthorization(AppPolicies.KitchenUpdate);

        return app;
    }
}
