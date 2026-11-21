using MediatR;
using System.Security.Claims;
using WTF.Api.Common.Auth;
using WTF.Api.Common.DTOs;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Inventory.Waste;
using WTF.Api.Features.Items;
using WTF.Api.Features.Items.DTOs;

namespace WTF.Api.Endpoints;

public record SetItemAlertRecipientsRequest(List<Guid>? UserIds);

public static class ItemEndpoints
{
    public static IEndpointRouteBuilder MapItems(this IEndpointRouteBuilder app)
    {
        var itemGroup = app.MapGroup("/api/items")
            .RequireAuthorization();

        itemGroup.MapGet("/",
            async ([AsParameters] GetItemsQuery query, ISender sender, ClaimsPrincipal user) =>
            {
                var result = await sender.Send(query);
                return Results.Ok(CostAccess.ForUser(result, user));
            })
            .RequireAuthorization(AppPolicies.ItemsRead);

        itemGroup.MapGet("/paged",
            async ([AsParameters] GetPagedItemsQuery query, ISender sender, ClaimsPrincipal user) =>
            {
                // Sorting by cost would leak the order of costs to someone who may not see them.
                var allowed = CostAccess.CanReadCosts(user) || !string.Equals(query.SortBy, "cost", StringComparison.OrdinalIgnoreCase)
                    ? query
                    : query with { SortBy = null };
                var result = await sender.Send(allowed);

                return Results.Ok(result with { Items = CostAccess.ForUser(result.Items.ToList(), user) });
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
            async (Guid id, ISender sender, ClaimsPrincipal user) =>
            {
                var result = await sender.Send(new GetItemByIdQuery(id));
                return result is not null ? Results.Ok(CostAccess.ForUser(result, user)) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ItemsRead)
            .WithName("GetItemById");

        itemGroup.MapGet("/{id:guid}/branch-settings",
            async (Guid id, ISender sender, ClaimsPrincipal user) =>
            {
                var item = await sender.Send(new GetItemByIdQuery(id));
                return item is not null ? Results.Ok(CostAccess.ForUser(item, user).BranchStocks ?? []) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ItemsRead);

        itemGroup.MapPut("/{id:guid}/branch-settings",
            async (Guid id, List<ItemBranchSettingInputDto> body, ISender sender, ClaimsPrincipal user) =>
            {
                var result = await sender.Send(new SaveItemBranchSettingsCommand(id, body, !CostAccess.CanReadCosts(user)));
                if (result is null)
                {
                    return Results.NotFound();
                }

                return Results.Ok(CostAccess.CanReadCosts(user) ? result : [.. result.Select(s => s with { CostPrice = null })]);
            })
            .RequireAuthorization(AppPolicies.ItemsWrite);

        itemGroup.MapPost("/",
            async (CreateItemCommand command, ISender sender, ClaimsPrincipal user) =>
            {
                var result = await sender.Send(command with { KeepCosts = !CostAccess.CanReadCosts(user) });
                return Results.CreatedAtRoute("GetItemById", new { id = result.Id }, CostAccess.ForUser(result, user));
            })
            .RequireAuthorization(AppPolicies.ItemsWrite);

        itemGroup.MapPut("/{id:guid}",
            async (Guid id, UpdateItemCommand command, ISender sender, ClaimsPrincipal user) =>
            {
                if (id != command.Id)
                {
                    return Results.BadRequest("ID mismatch");
                }

                var result = await sender.Send(command with { KeepCosts = !CostAccess.CanReadCosts(user) });
                return result is not null ? Results.Ok(CostAccess.ForUser(result, user)) : Results.NotFound();
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
            async (Guid id, AddItemStockCommand command, ISender sender, ClaimsPrincipal user) =>
            {
                if (id != command.ItemId)
                {
                    return Results.BadRequest("Item ID mismatch");
                }

                var result = await sender.Send(command);
                return result is not null ? Results.Ok(CostAccess.ForUser(result, user)) : Results.NotFound();
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
            async (Guid id, AdjustItemStockCommand command, ISender sender, ClaimsPrincipal user) =>
            {
                if (id != command.ItemId)
                {
                    return Results.BadRequest("Item ID mismatch");
                }

                var result = await sender.Send(command);
                return result is not null ? Results.Ok(CostAccess.ForUser(result, user)) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.StockMovementsWrite);

        itemGroup.MapGet("/{id:guid}/movements",
            async (Guid id, string? type, int? page, int? pageSize, ISender sender, ClaimsPrincipal user) =>
            {
                var result = await sender.Send(new GetItemMovementsQuery(id, type, page ?? 1, pageSize ?? 25));
                return result is not null ? Results.Ok(CostAccess.ForUser(result, user)) : Results.NotFound();
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
            async (Guid id, AssignItemProductLinksCommand command, ISender sender, ClaimsPrincipal user) =>
            {
                if (id != command.ItemId)
                {
                    return Results.BadRequest("Item ID mismatch");
                }

                var result = await sender.Send(command);
                return result is not null ? Results.Ok(CostAccess.ForUser(result, user)) : Results.NotFound();
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
