using MediatR;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Inventory;

namespace WTF.Api.Endpoints;

public static class InventoryEndpoints
{
    public static IEndpointRouteBuilder MapInventory(this IEndpointRouteBuilder app)
    {
        var inventoryGroup = app.MapGroup("/api/inventory")
            .RequireAuthorization();

        inventoryGroup.MapGet("/",
            async ([AsParameters] GetInventoryItemsQuery query, ISender sender) =>
            {
                var result = await sender.Send(query);
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.ManagementRead);

        inventoryGroup.MapGet("/{id:guid}",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new GetInventoryItemByIdQuery(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ManagementRead)
            .WithName("GetInventoryItemById");

        inventoryGroup.MapPost("/",
            async (CreateInventoryItemCommand command, ISender sender) =>
            {
                var result = await sender.Send(command);
                return Results.CreatedAtRoute("GetInventoryItemById", new { id = result.Id }, result);
            })
            .RequireAuthorization(AppPolicies.ManagementWrite);

        inventoryGroup.MapPut("/{id:guid}",
            async (Guid id, UpdateInventoryItemCommand command, ISender sender) =>
            {
                if (id != command.Id)
                {
                    return Results.BadRequest("ID mismatch");
                }

                var result = await sender.Send(command);
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ManagementWrite);

        inventoryGroup.MapDelete("/{id:guid}",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new DeleteInventoryItemCommand(id));
                return result ? Results.NoContent() : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ManagementWrite);

        inventoryGroup.MapPost("/{id:guid}/stock",
            async (Guid id, AddInventoryStockCommand command, ISender sender) =>
            {
                if (id != command.InventoryItemId)
                {
                    return Results.BadRequest("Inventory item ID mismatch");
                }

                var result = await sender.Send(command);
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ManagementWrite);

        inventoryGroup.MapPost("/product-links",
            async (LinkProductInventoryCommand command, ISender sender) =>
            {
                var result = await sender.Send(command);
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.ManagementWrite);

        return app;
    }
}
