using MediatR;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Inventory.Waste;

namespace WTF.Api.Endpoints;

public static class StockWasteEndpoints
{
    public static IEndpointRouteBuilder MapStockWaste(this IEndpointRouteBuilder app)
    {
        var wasteGroup = app.MapGroup("/api/stock-waste")
            .RequireAuthorization();

        wasteGroup.MapGet("/",
            async ([AsParameters] GetStockWastesQuery query, ISender sender) =>
            {
                var result = await sender.Send(query);
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.StockMovementsRead);

        wasteGroup.MapGet("/pending-count",
            async (ISender sender) =>
            {
                var result = await sender.Send(new GetPendingWasteCountQuery());
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.StockWasteReview);

        wasteGroup.MapPost("/{id:guid}/confirm",
            async (Guid id, ReviewWasteRequest? request, ISender sender) =>
            {
                var result = await sender.Send(new ConfirmWasteCommand(id, request?.Note));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.StockWasteReview);

        wasteGroup.MapPost("/{id:guid}/dispute",
            async (Guid id, ReviewWasteRequest? request, ISender sender) =>
            {
                var result = await sender.Send(new DisputeWasteCommand(id, request?.Note));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.StockWasteReview);

        wasteGroup.MapPost("/{id:guid}/reverse",
            async (Guid id, ReverseWasteRequest? request, ISender sender) =>
            {
                var result = await sender.Send(new ReverseWasteCommand(id, request?.Reason));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.StockWasteReview);

        app.MapGet("/api/pos/waste-items",
            async (ISender sender) =>
            {
                var result = await sender.Send(new GetPosWasteItemsQuery());
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.StockWasteWrite);

        var reasonGroup = app.MapGroup("/api/waste-reasons")
            .RequireAuthorization();

        reasonGroup.MapGet("/",
            async (bool? includeInactive, ISender sender) =>
            {
                var result = await sender.Send(new GetWasteReasonsQuery(includeInactive ?? false));
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.WasteReasonsRead);

        reasonGroup.MapPost("/",
            async (WasteReasonRequest request, ISender sender) =>
            {
                var result = await sender.Send(new CreateWasteReasonCommand(request.Name, request.RequiresNote, request.SortOrder));
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.WasteReasonsManage);

        reasonGroup.MapPut("/{id:int}",
            async (int id, WasteReasonRequest request, ISender sender) =>
            {
                var result = await sender.Send(new UpdateWasteReasonCommand(id, request.Name, request.RequiresNote, request.SortOrder));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.WasteReasonsManage);

        reasonGroup.MapPost("/{id:int}/deactivate",
            async (int id, ISender sender) =>
            {
                var result = await sender.Send(new DeactivateWasteReasonCommand(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.WasteReasonsManage);

        reasonGroup.MapPost("/{id:int}/restore",
            async (int id, ISender sender) =>
            {
                var result = await sender.Send(new RestoreWasteReasonCommand(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.WasteReasonsManage);

        return app;
    }
}
