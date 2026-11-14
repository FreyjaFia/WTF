using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Data;

namespace WTF.Api.Endpoints;

public record RejectOrderRequest(string Reason);

public record RejectHeldOrderRequest(string Reason, string? StockOutcome = null);

public record ApproveHeldOrderRequest(List<SeniorPwdIdFix>? SeniorPwdIds = null);

public record BulkApproveHeldOrdersRequest(
    List<string>? ReasonCodes = null,
    Guid? CashierId = null,
    DateTime? FromDate = null,
    DateTime? ToDate = null,
    bool AgedOnly = false,
    List<Guid>? Ids = null,
    bool Preview = true);

public record SyncOfflineOrdersRequest(List<CreateOrderCommand> Orders);

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

        // GET /api/orders/paged - Get paged orders
        orderGroup.MapGet("/paged",
            async ([AsParameters] GetPagedOrdersQuery query, ISender sender) =>
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

        // GET /api/orders/senior-pwd/id-check - Has this ID already been given the Senior/PWD discount today? (soft warning)
        orderGroup.MapGet("/senior-pwd/id-check",
            async (string idNumber, ISender sender, HttpContext http) =>
            {
                if (!PermissionChecks.Has(http.User, SeniorPwdOrders.ApplyPermission))
                {
                    return Results.Forbid();
                }

                return Results.Ok(await sender.Send(new SeniorPwdIdCheckQuery(idNumber)));
            })
            .RequireAuthorization(AppPolicies.OrdersWrite);

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
            async (CreateOrderCommand command, ISender sender, WTFDbContext db) =>
            {
                // A retry after a lost response carries the same key: answer with the order that was already saved.
                var key = command.OfflineLocalId?.Trim();
                if (!string.IsNullOrEmpty(key))
                {
                    var savedId = await db.Orders.AsNoTracking()
                        .Where(o => o.OfflineLocalId == key)
                        .Select(o => (Guid?)o.Id)
                        .FirstOrDefaultAsync();
                    var saved = savedId is null ? null : await sender.Send(new GetOrderByIdQuery(savedId.Value));
                    if (saved is not null)
                    {
                        return Results.Ok(saved);
                    }
                }

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

        // POST /api/orders/sync - Sync orders sold offline: each one gets its own result, and a changed catalog holds an order for review
        orderGroup.MapPost("/sync",
            async (SyncOfflineOrdersRequest request, ISender sender) =>
            {
                var result = await sender.Send(new SyncOfflineOrdersCommand(request.Orders));
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

        // PUT /api/orders/{id}/override - Correct a completed order (Admin and above, reason required)
        orderGroup.MapPut("/{id:guid}/override",
            async (Guid id, UpdateOrderCommand command, ISender sender) =>
            {
                if (id != command.Id)
                {
                    return Results.BadRequest("ID mismatch");
                }

                var result = await sender.Send(command with { IsOverride = true });
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.OrdersOverride);

        // POST /api/orders/{id}/approve - Accept an order a customer placed through their link (-> Pending)
        orderGroup.MapPost("/{id:guid}/approve",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new ApproveOrderCommand(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.OrdersWrite);

        // POST /api/orders/{id}/ready - An accepted customer order is ready for pickup or delivery
        orderGroup.MapPost("/{id:guid}/ready",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new MarkOrderReadyCommand(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.OrdersWrite);

        // POST /api/orders/{id}/reject - Turn down an order a customer placed through their link (reason required)
        orderGroup.MapPost("/{id:guid}/reject",
            async (Guid id, RejectOrderRequest request, ISender sender) =>
            {
                var result = await sender.Send(new RejectOrderCommand(id, request.Reason));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.OrdersWrite);

        // GET /api/orders/review - Held offline orders with their reasons and age, filtered
        orderGroup.MapGet("/review",
            async (string? reasonCodes, Guid? cashierId, DateTime? fromDate, DateTime? toDate, bool? agedOnly, ISender sender) =>
            {
                var codes = string.IsNullOrWhiteSpace(reasonCodes)
                    ? null
                    : reasonCodes.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                var result = await sender.Send(new GetHeldOrdersQuery(
                    new HeldOrderFilter(codes, cashierId, fromDate, toDate, agedOnly ?? false)));
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.OrdersOverride);

        // POST /api/orders/review/bulk-approve - Approve many held orders at once (preview first), one transaction each
        orderGroup.MapPost("/review/bulk-approve",
            async (BulkApproveHeldOrdersRequest request, ISender sender) =>
            {
                var filter = new HeldOrderFilter(
                    request.ReasonCodes?.Where(c => !string.IsNullOrWhiteSpace(c)).Select(c => c.Trim()).ToList(),
                    request.CashierId,
                    request.FromDate,
                    request.ToDate,
                    request.AgedOnly,
                    request.Ids);
                var result = await sender.Send(new BulkApproveHeldOrdersCommand(filter, request.Preview));
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.OrdersOverride);

        // POST /api/orders/{id}/review/approve - An Admin approves a held offline order (-> Completed at the quoted prices)
        orderGroup.MapPost("/{id:guid}/review/approve",
            async (Guid id, ISender sender, ApproveHeldOrderRequest? request) =>
            {
                var result = await sender.Send(new ApproveHeldOrderCommand(id, request?.SeniorPwdIds));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.OrdersOverride);

        // POST /api/orders/{id}/review/reject - An Admin turns down a held offline order (reason required)
        orderGroup.MapPost("/{id:guid}/review/reject",
            async (Guid id, RejectHeldOrderRequest request, ISender sender) =>
            {
                var result = await sender.Send(new RejectHeldOrderCommand(id, request.Reason, request.StockOutcome));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.OrdersOverride);

        // GET /api/orders/sync-policy - The shop's offline sync policy (Owner only)
        orderGroup.MapGet("/sync-policy",
            async (ISender sender) => Results.Ok(await sender.Send(new GetOfflineSyncPolicyQuery())))
            .RequireAuthorization(AppPolicies.OrdersSyncPolicy);

        // PUT /api/orders/sync-policy - Change the policy (Owner only, audited)
        orderGroup.MapPut("/sync-policy",
            async (UpdateOfflineSyncPolicyCommand command, ISender sender) => Results.Ok(await sender.Send(command)))
            .RequireAuthorization(AppPolicies.OrdersSyncPolicy);

        orderGroup.MapGet("/{id:guid}/stock-movements",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new GetOrderStockMovementsQuery(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.StockMovementsRead);

        // PATCH /api/orders/{id}/void - Void order (Pending -> Cancelled, Completed -> Refunded)
        orderGroup.MapPatch("/{id:guid}/void",
            async (Guid id, VoidOrderRequestDto request, ISender sender) =>
            {
                var result = await sender.Send(new VoidOrderCommand(id, request.Note, request.NotReturnedLineIds));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.OrdersWrite);

        return app;
    }

    private sealed record VoidOrderRequestDto(string? Note, List<Guid>? NotReturnedLineIds = null);
}
