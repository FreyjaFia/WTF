using MediatR;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Audit;

namespace WTF.Api.Endpoints;

public static class AuditEndpoints
{
    public static IEndpointRouteBuilder MapAudit(this IEndpointRouteBuilder app)
    {
        var auditGroup = app.MapGroup("/api/audit-logs")
            .RequireAuthorization(AppPolicies.ManagementRead);

        auditGroup.MapGet("/",
            async ([AsParameters] GetAuditLogsQuery query, ISender sender) =>
            {
                var result = await sender.Send(query);
                return Results.Ok(result);
            });

        return app;
    }
}
