using MediatR;
using System.Security.Claims;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Inventory.Suppliers;

namespace WTF.Api.Endpoints;

public static class SupplierEndpoints
{
    public static IEndpointRouteBuilder MapSuppliers(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/suppliers")
            .RequireAuthorization();

        group.MapGet("/",
            async (bool? includeInactive, string? search, ISender sender) =>
                Results.Ok(await sender.Send(new GetSuppliersQuery(includeInactive ?? false, search))))
            .RequireAuthorization(AppPolicies.StockMovementsRead);

        group.MapGet("/{id:guid}",
            async (Guid id, ISender sender, ClaimsPrincipal user) =>
            {
                var result = await sender.Send(new GetSupplierQuery(id));
                return result is not null ? Results.Ok(CostAccess.ForUser(result, user)) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.StockMovementsRead);

        group.MapPost("/",
            async (SupplierFields fields, ISender sender, ClaimsPrincipal user) =>
            {
                var result = await sender.Send(new CreateSupplierCommand(fields));
                return Results.Created($"/api/suppliers/{result.Summary.Id}", CostAccess.ForUser(result, user));
            })
            .RequireAuthorization(AppPolicies.StockMovementsWrite);

        group.MapPut("/{id:guid}",
            async (Guid id, SupplierFields fields, ISender sender, ClaimsPrincipal user) =>
            {
                var result = await sender.Send(new UpdateSupplierCommand(id, fields));
                return result is not null ? Results.Ok(CostAccess.ForUser(result, user)) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.StockMovementsWrite);

        group.MapPost("/{id:guid}/deactivate",
            async (Guid id, ISender sender, ClaimsPrincipal user) =>
            {
                var result = await sender.Send(new SetSupplierActiveCommand(id, false));
                return result is not null ? Results.Ok(CostAccess.ForUser(result, user)) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.StockMovementsWrite);

        group.MapPost("/{id:guid}/restore",
            async (Guid id, ISender sender, ClaimsPrincipal user) =>
            {
                var result = await sender.Send(new SetSupplierActiveCommand(id, true));
                return result is not null ? Results.Ok(CostAccess.ForUser(result, user)) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.StockMovementsWrite);

        var itemGroup = app.MapGroup("/api/items/{itemId:guid}/suppliers")
            .RequireAuthorization();

        itemGroup.MapGet("/",
            async (Guid itemId, ISender sender, ClaimsPrincipal user) =>
            {
                var result = await sender.Send(new GetItemSuppliersQuery(itemId));
                return result is not null ? Results.Ok(CostAccess.ForUser(result, user)) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.StockMovementsRead);

        itemGroup.MapPut("/{supplierId:guid}",
            async (Guid itemId, Guid supplierId, SaveItemSupplierCommand command, ISender sender, ClaimsPrincipal user) =>
            {
                var result = await sender.Send(command with { ItemId = itemId, SupplierId = supplierId });
                return result is not null ? Results.Ok(CostAccess.ForUser(result, user)) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.StockMovementsWrite);

        itemGroup.MapDelete("/{supplierId:guid}",
            async (Guid itemId, Guid supplierId, ISender sender, ClaimsPrincipal user) =>
            {
                var result = await sender.Send(new RemoveItemSupplierCommand(itemId, supplierId));
                return result is not null ? Results.Ok(CostAccess.ForUser(result, user)) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.StockMovementsWrite);

        return app;
    }
}
