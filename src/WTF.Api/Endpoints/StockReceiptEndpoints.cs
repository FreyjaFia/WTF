using MediatR;
using System.Security.Claims;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Inventory.Receiving;

namespace WTF.Api.Endpoints;

public static class StockReceiptEndpoints
{
    public static IEndpointRouteBuilder MapStockReceipts(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/stock-receipts")
            .RequireAuthorization();

        group.MapGet("/",
            async (Guid? supplierId, DateOnly? from, DateOnly? to, string? search, int? take, ISender sender, ClaimsPrincipal user) =>
            {
                var result = await sender.Send(new GetStockReceiptsQuery(supplierId, from, to, search, take ?? 100));
                return Results.Ok(CostAccess.ForUser(result, user));
            })
            .RequireAuthorization(AppPolicies.PurchasingRead);

        group.MapGet("/{id:guid}",
            async (Guid id, ISender sender, ClaimsPrincipal user) =>
            {
                var result = await sender.Send(new GetStockReceiptQuery(id));
                return result is not null ? Results.Ok(CostAccess.ForUser(result, user)) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.PurchasingRead);

        group.MapPost("/",
            async (RecordStockReceiptCommand command, ISender sender, ClaimsPrincipal user) =>
            {
                var result = await sender.Send(command);
                return Results.Created($"/api/stock-receipts/{result.Summary.Id}", CostAccess.ForUser(result, user));
            })
            .RequireAuthorization(AppPolicies.PurchasingWrite);

        return app;
    }
}
