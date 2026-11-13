using MediatR;
using System.Security.Claims;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Inventory.Purchasing;

namespace WTF.Api.Endpoints;

public record CreatePurchaseOrderFromReorderRequest(Guid SupplierId);

public static class PurchaseOrderEndpoints
{
    public static IEndpointRouteBuilder MapPurchaseOrders(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/purchase-orders")
            .RequireAuthorization();

        group.MapGet("/",
            async (byte? status, Guid? supplierId, bool? openOnly, ISender sender, ClaimsPrincipal user) =>
            {
                var result = await sender.Send(new GetPurchaseOrdersQuery(status, supplierId, openOnly ?? false));
                return Results.Ok(CostAccess.ForUser(result, user));
            })
            .RequireAuthorization(AppPolicies.PurchasingRead);

        group.MapGet("/{id:guid}",
            async (Guid id, ISender sender, ClaimsPrincipal user) =>
            {
                var result = await sender.Send(new GetPurchaseOrderQuery(id));
                return result is not null ? Results.Ok(CostAccess.ForUser(result, user)) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.PurchasingRead);

        group.MapPost("/",
            async (PurchaseOrderFields fields, ISender sender, ClaimsPrincipal user) =>
            {
                var result = await sender.Send(new CreatePurchaseOrderCommand(fields));
                return Results.Created($"/api/purchase-orders/{result.Summary.Id}", CostAccess.ForUser(result, user));
            })
            .RequireAuthorization(AppPolicies.PurchasingWrite);

        group.MapPost("/from-reorder",
            async (CreatePurchaseOrderFromReorderRequest request, ISender sender, ClaimsPrincipal user) =>
            {
                var result = await sender.Send(new CreatePurchaseOrderFromReorderCommand(request.SupplierId));
                return Results.Created($"/api/purchase-orders/{result.Summary.Id}", CostAccess.ForUser(result, user));
            })
            .RequireAuthorization(AppPolicies.PurchasingWrite);

        group.MapPut("/{id:guid}",
            async (Guid id, PurchaseOrderFields fields, ISender sender, ClaimsPrincipal user) =>
            {
                var result = await sender.Send(new UpdatePurchaseOrderCommand(id, fields));
                return result is not null ? Results.Ok(CostAccess.ForUser(result, user)) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.PurchasingWrite);

        MapAction(group, "send", SetPurchaseOrderStatusHandler.Send);
        MapAction(group, "cancel", SetPurchaseOrderStatusHandler.Cancel);
        MapAction(group, "close", SetPurchaseOrderStatusHandler.Close);

        return app;
    }

    private static void MapAction(RouteGroupBuilder group, string route, string action) =>
        group.MapPost($"/{{id:guid}}/{route}",
            async (Guid id, ISender sender, ClaimsPrincipal user) =>
            {
                var result = await sender.Send(new SetPurchaseOrderStatusCommand(id, action));
                return result is not null ? Results.Ok(CostAccess.ForUser(result, user)) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.PurchasingWrite);
}
