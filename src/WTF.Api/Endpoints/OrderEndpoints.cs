using MediatR;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.Enums;

namespace WTF.Api.Endpoints;

public static class OrderEndpoints
{
    public static IEndpointRouteBuilder MapOrders(this IEndpointRouteBuilder app)
    {
        var orderGroup = app.MapGroup("/api/orders")
            .RequireAuthorization();

        // GET /api/orders - Get all orders
        orderGroup.MapGet("/",
            async ([AsParameters] GetOrdersQuery query, ISender sender) =>
            {
                var result = await sender.Send(query);
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.OrdersRead);

        // GET /api/orders/active - Get editable orders only (exclude completed/refunded)
        orderGroup.MapGet("/active",
            async (Guid? customerId, ISender sender) =>
            {
                var result = await sender.Send(new GetOrdersQuery(
                    Status: OrderStatusEnum.All,
                    CustomerId: customerId,
                    ExcludeFinalized: true));
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.OrdersRead);

        // GET /api/orders/history - Get non-editable order summaries (completed/refunded)
        orderGroup.MapGet("/history",
            async (Guid? customerId, ISender sender) =>
            {
                var result = await sender.Send(new GetOrderHistoryQuery(customerId));
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.OrdersRead);

        // GET /api/orders/{id} - Get order by ID
        orderGroup.MapGet("/{id:guid}",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new GetOrderByIdQuery(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.OrdersRead);

        // POST /api/orders - Create new order
        orderGroup.MapPost("/",
            async (CreateOrderCommand command, ISender sender) =>
            {
                var result = await sender.Send(command);
                return Results.Created($"/api/orders/{result.Id}", result);
            })
            .RequireAuthorization(AppPolicies.OrdersWrite);

        // POST /api/orders/batch - Create multiple orders in one request
        orderGroup.MapPost("/batch",
            async (CreateOrderBatchCommand command, ISender sender) =>
            {
                var result = await sender.Send(command);
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.OrdersWrite);

        // PUT /api/orders/{id} - Update order
        orderGroup.MapPut("/{id:guid}",
            async (Guid id, UpdateOrderCommand command, ISender sender) =>
            {
                if (id != command.Id)
                {
                    return Results.BadRequest("ID mismatch");
                }
                var result = await sender.Send(command);
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.OrdersWrite);

        // PATCH /api/orders/{id}/void - Void order (Pending -> Cancelled, Completed -> Refunded)
        orderGroup.MapPatch("/{id:guid}/void",
            async (Guid id, VoidOrderRequestDto request, ISender sender) =>
            {
                var result = await sender.Send(new VoidOrderCommand(id, request.Note));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.OrdersWrite);

        return app;
    }

    private sealed record VoidOrderRequestDto(string? Note);
}
