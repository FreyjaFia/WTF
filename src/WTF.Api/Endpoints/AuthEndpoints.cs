using MediatR;
using Microsoft.AspNetCore.Authorization;
using WTF.Contracts.Auth.Login;
using WTF.Contracts.Auth.Validate;

namespace WTF.Api.Endpoints;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuth(this IEndpointRouteBuilder app)
    {
        var authGroup = app.MapGroup("/api/auth");

        authGroup.MapPost("/login",
            async (LoginCommand loginCommand, ISender sender) =>
            {
                var result = await sender.Send(loginCommand);
                return result is not null ? Results.Ok(result) : Results.Unauthorized();
            });

        authGroup.MapGet("/validate",
            [Authorize] () =>
            {
                var response = new ValidateTokenDto(true, "Token is valid", DateTime.UtcNow);
                return Results.Ok(response);
            })
            .RequireAuthorization();

        return app;
    }
}