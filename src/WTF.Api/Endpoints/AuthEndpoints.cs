using MediatR;
using WTF.Api.Features.Auth.Login;

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

        return app;
    }
}