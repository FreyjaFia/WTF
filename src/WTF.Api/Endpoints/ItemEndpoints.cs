using MediatR;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Inventory.Waste;
using WTF.Api.Features.Items;

namespace WTF.Api.Endpoints;

public record SetItemAlertRecipientsRequest(List<Guid>? UserIds);

public static class ItemEndpoints
{
    public static IEndpointRouteBuilder MapItems(this IEndpointRouteBuilder app)
    {
        var itemGroup = app.MapGroup("/api/items")
            .RequireAuthorization();

        itemGroup.MapGet("/",
            async ([AsParameters] GetItemsQuery query, ISender sender) =>
            {
                var result = await sender.Send(query);
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.ItemsRead);

        itemGroup.MapGet("/attention",
            async (ISender sender) =>
            {
                var result = await sender.Send(new GetStockAttentionQuery());
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.StockMovementsRead);

        itemGroup.MapGet("/coverage",
            async (ISender sender) =>
            {
                var result = await sender.Send(new GetStockCoverageQuery());
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.ItemsRead);

        itemGroup.MapGet("/{id:guid}",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new GetItemByIdQuery(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ItemsRead)
            .WithName("GetItemById");

        itemGroup.MapPost("/",
            async (CreateItemCommand command, ISender sender) =>
            {
                var result = await sender.Send(command);
                return Results.CreatedAtRoute("GetItemById", new { id = result.Id }, result);
            })
            .RequireAuthorization(AppPolicies.ItemsWrite);

        itemGroup.MapPut("/{id:guid}",
            async (Guid id, UpdateItemCommand command, ISender sender) =>
            {
                if (id != command.Id)
                {
                    return Results.BadRequest("ID mismatch");
                }

                var result = await sender.Send(command);
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ItemsWrite);

        itemGroup.MapDelete("/{id:guid}",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new DeleteItemCommand(id));
                return result ? Results.NoContent() : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ItemsWrite);

        itemGroup.MapPost("/{id:guid}/restore",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new RestoreItemCommand(id));
                return result ? Results.NoContent() : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ItemsWrite);

        itemGroup.MapPost("/{id:guid}/stock",
            async (Guid id, AddItemStockCommand command, ISender sender) =>
            {
                if (id != command.ItemId)
                {
                    return Results.BadRequest("Item ID mismatch");
                }

                var result = await sender.Send(command);
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.StockMovementsWrite);

        itemGroup.MapPost("/{id:guid}/stock/waste",
            async (Guid id, RecordWasteRequest request, ISender sender) =>
            {
                var result = await sender.Send(new RecordWasteCommand(
                    id,
                    request.Quantity,
                    request.WasteReasonId,
                    request.Notes,
                    request.Source,
                    request.ClientRequestId));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.StockWasteWrite);

        itemGroup.MapPost("/{id:guid}/stock/adjust",
            async (Guid id, AdjustItemStockCommand command, ISender sender) =>
            {
                if (id != command.ItemId)
                {
                    return Results.BadRequest("Item ID mismatch");
                }

                var result = await sender.Send(command);
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.StockMovementsWrite);

        itemGroup.MapGet("/{id:guid}/movements",
            async (Guid id, string? type, int? page, int? pageSize, ISender sender) =>
            {
                var result = await sender.Send(new GetItemMovementsQuery(id, type, page ?? 1, pageSize ?? 25));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.StockMovementsRead);

        itemGroup.MapGet("/{id:guid}/alert-recipients",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new GetItemAlertRecipientsQuery(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ItemsRead);

        itemGroup.MapPut("/{id:guid}/alert-recipients",
            async (Guid id, SetItemAlertRecipientsRequest request, ISender sender) =>
            {
                var result = await sender.Send(new SetItemAlertRecipientsCommand(id, request.UserIds ?? []));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ItemsWrite);

        itemGroup.MapPost("/product-links",
            async (LinkProductItemCommand command, ISender sender) =>
            {
                var result = await sender.Send(command);
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.ItemsWrite);

        itemGroup.MapPut("/{id:guid}/product-links",
            async (Guid id, AssignItemProductLinksCommand command, ISender sender) =>
            {
                if (id != command.ItemId)
                {
                    return Results.BadRequest("Item ID mismatch");
                }

                var result = await sender.Send(command);
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ItemsWrite);

        app.MapGet("/api/pos/stock-limits",
            async (ISender sender) =>
            {
                var result = await sender.Send(new GetPosStockLimitsQuery());
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.OrdersWrite);

        return app;
    }
}
