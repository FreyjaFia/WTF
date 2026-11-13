using MediatR;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Orders;

namespace WTF.Api.Endpoints;

public record DiscardUnsyncedOrderRequest(string Reason);

public static class UnsyncedOrderEndpoints
{
    public static IEndpointRouteBuilder MapUnsyncedOrders(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/orders/unsynced")
            .RequireAuthorization(AppPolicies.OrdersOverride);

        // GET /api/orders/unsynced - Orders a register sold offline that the server could not save (Admin)
        group.MapGet("/",
            async ([AsParameters] GetUnsyncedOrdersQuery query, ISender sender) =>
            {
                var result = await sender.Send(query);
                return Results.Ok(result);
            });

        group.MapGet("/{id:guid}",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new GetUnsyncedOrderByIdQuery(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            });

        // POST /api/orders/unsynced/{id}/retry - Run the sync again for the stored order; it is resolved when it saves
        group.MapPost("/{id:guid}/retry",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new RetryUnsyncedOrderCommand(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            });

        // POST /api/orders/unsynced/{id}/note-only - Keep the sale as a cancelled record for the cash drawer
        group.MapPost("/{id:guid}/note-only",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new NoteOnlyUnsyncedOrderCommand(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            });

        // POST /api/orders/unsynced/{id}/discard - Drop the order for a reason (required)
        group.MapPost("/{id:guid}/discard",
            async (Guid id, DiscardUnsyncedOrderRequest request, ISender sender) =>
            {
                var result = await sender.Send(new DiscardUnsyncedOrderCommand(id, request.Reason));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            });

        return app;
    }
}
