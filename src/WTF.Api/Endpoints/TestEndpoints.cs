using Microsoft.AspNetCore.Authorization;

namespace WTF.Api.Endpoints;

public static class TestEndpoints
{
    public static IEndpointRouteBuilder MapTest(this IEndpointRouteBuilder app)
    {
        var testGroup = app.MapGroup("/api/test");

        testGroup.MapGet("/protected",
            [Authorize] () =>
            {
                return Results.Ok(new { message = "Token is working! You are authenticated.", timestamp = DateTime.UtcNow });
            })
            .RequireAuthorization();

        testGroup.MapGet("/public", () =>
        {
            return Results.Ok(new { message = "This is a public endpoint", timestamp = DateTime.UtcNow });
        });

        return app;
    }
}
