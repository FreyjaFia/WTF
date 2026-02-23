using MediatR;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Sync;

namespace WTF.Api.Endpoints;

public static class SyncEndpoints
{
    public static IEndpointRouteBuilder MapSync(this IEndpointRouteBuilder app)
    {
        var syncGroup = app.MapGroup("/api/sync")
            .RequireAuthorization();

        syncGroup.MapGet("/pos-catalog",
            async (ISender sender) =>
            {
                var result = await sender.Send(new GetPosCatalogQuery());
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.ProductsRead);

        return app;
    }
}
