using MediatR;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Audit;

namespace WTF.Api.Endpoints;

public static class SchemaScriptHistoryEndpoints
{
    public static IEndpointRouteBuilder MapSchemaScriptHistory(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/schema-script-history")
            .RequireAuthorization(AppPolicies.ManagementRead);

        group.MapGet("/",
            async (ISender sender) =>
            {
                var result = await sender.Send(new GetSchemaScriptHistoryQuery());
                return Results.Ok(result);
            });

        return app;
    }
}
