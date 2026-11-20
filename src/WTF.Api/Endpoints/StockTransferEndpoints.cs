using MediatR;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Inventory.Transfers;
using WTF.Calculations.Subscriptions;

namespace WTF.Api.Endpoints;

public static class StockTransferEndpoints
{
    public static IEndpointRouteBuilder MapStockTransfers(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/stock-transfers")
            .RequireAuthorization()
            .RequireAuthorization(AppPolicies.RequireFeature(PlanFeatures.Branches));

        group.MapGet("/paged",
            async ([AsParameters] GetPagedStockTransfersQuery query, ISender sender) => Results.Ok(await sender.Send(query)))
            .RequireAuthorization(AppPolicies.StockMovementsRead);

        group.MapGet("/{id:guid}",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new GetStockTransferQuery(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.StockMovementsRead);

        group.MapPost("/",
            async (CreateStockTransferCommand command, ISender sender) =>
            {
                var result = await sender.Send(command);
                return Results.Created($"/api/stock-transfers/{result.Summary.Id}", result);
            })
            .RequireAuthorization(AppPolicies.StockMovementsWrite);

        return app;
    }
}
