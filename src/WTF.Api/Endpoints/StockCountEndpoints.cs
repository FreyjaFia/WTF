using MediatR;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Inventory.Counts;

namespace WTF.Api.Endpoints;

public record SaveStockCountLinesRequest(List<StockCountEntry> Lines);

public static class StockCountEndpoints
{
    public static IEndpointRouteBuilder MapStockCounts(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/stock-counts")
            .RequireAuthorization();

        group.MapGet("/",
            async (byte? status, ISender sender) => Results.Ok(await sender.Send(new GetStockCountsQuery(status))))
            .RequireAuthorization(AppPolicies.StockMovementsRead);

        group.MapGet("/{id:guid}",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new GetStockCountQuery(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.StockMovementsRead);

        group.MapPost("/",
            async (StartStockCountCommand command, ISender sender) =>
            {
                var result = await sender.Send(command);
                return Results.Created($"/api/stock-counts/{result.Summary.Id}", result);
            })
            .RequireAuthorization(AppPolicies.StockMovementsWrite);

        group.MapPut("/{id:guid}/lines",
            async (Guid id, SaveStockCountLinesRequest request, ISender sender) =>
            {
                var result = await sender.Send(new SaveStockCountLinesCommand { CountId = id, Lines = request.Lines });
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.StockMovementsWrite);

        group.MapPost("/{id:guid}/post",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new PostStockCountCommand(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.StockMovementsWrite);

        group.MapPost("/{id:guid}/cancel",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new CancelStockCountCommand(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.StockMovementsWrite);

        return app;
    }
}
