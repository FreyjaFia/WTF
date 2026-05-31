using MediatR;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Items;

namespace WTF.Api.Endpoints;

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
            .RequireAuthorization(AppPolicies.ItemsWrite);

        itemGroup.MapPost("/product-links",
            async (LinkProductItemCommand command, ISender sender) =>
            {
                var result = await sender.Send(command);
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.ItemsWrite);

        return app;
    }
}
