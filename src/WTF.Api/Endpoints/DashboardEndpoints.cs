using MediatR;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Dashboard;

namespace WTF.Api.Endpoints;

public static class DashboardEndpoints
{
    public static IEndpointRouteBuilder MapDashboard(this IEndpointRouteBuilder app)
    {
        var dashboardGroup = app.MapGroup("/api/dashboard")
            .RequireAuthorization();

        // GET /api/dashboard - Get dashboard summary
        dashboardGroup.MapGet("/",
            async (ISender sender) =>
            {
                var result = await sender.Send(new GetDashboardQuery());
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.DashboardRead);

        return app;
    }
}
