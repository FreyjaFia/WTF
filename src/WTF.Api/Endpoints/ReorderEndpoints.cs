using MediatR;
using System.Security.Claims;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Inventory.Reordering;

namespace WTF.Api.Endpoints;

public record SetParLevelRequest(decimal? ParLevel);

public static class ReorderEndpoints
{
    public static IEndpointRouteBuilder MapReordering(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/reorder")
            .RequireAuthorization();

        group.MapGet("/",
            async (int? days, ISender sender, ClaimsPrincipal user) =>
            {
                var result = await sender.Send(new GetReorderListQuery(days ?? 28));
                return Results.Ok(CostAccess.ForUser(result, user));
            })
            .RequireAuthorization(AppPolicies.PurchasingRead);

        group.MapGet("/par-levels",
            async (ISender sender) => Results.Ok(await sender.Send(new GetParLevelsQuery())))
            .RequireAuthorization(AppPolicies.PurchasingRead);

        group.MapPut("/par-levels/{itemId:guid}",
            async (Guid itemId, SetParLevelRequest request, ISender sender) =>
            {
                var result = await sender.Send(new SetParLevelCommand(itemId, request.ParLevel));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.PurchasingWrite);

        return app;
    }
}
