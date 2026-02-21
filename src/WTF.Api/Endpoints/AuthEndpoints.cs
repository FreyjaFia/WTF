using MediatR;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Auth;
using WTF.Api.Features.Auth.DTOs;
using WTF.Api.Features.Users;

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

        authGroup.MapPost("/logout", async (RefreshTokenRequestDto request, IMediator mediator) =>
        {
            var result = await mediator.Send(new LogoutCommand(request.RefreshToken));

            if (!result)
            {
                return Results.BadRequest(new { Message = "Invalid refresh token" });
            }

            return Results.Ok(new { Message = "Logged out successfully" });
        });

        authGroup.MapPost("/refresh", async (RefreshTokenRequestDto request, IMediator mediator) =>
        {
            var result = await mediator.Send(new RefreshTokenCommand(request.RefreshToken));

            if (result is null)
            {
                return Results.Unauthorized();
            }

            return Results.Ok(result);
        });

        authGroup.MapPost("/validate", async (HttpRequest httpRequest, IMediator mediator) =>
        {
            var authHeader = httpRequest.Headers.Authorization.ToString();

            if (string.IsNullOrEmpty(authHeader) || !authHeader.StartsWith("Bearer "))
            {
                return Results.BadRequest(new { Message = "Invalid authorization header" });
            }

            var token = authHeader["Bearer ".Length..].Trim();
            var result = await mediator.Send(new ValidateTokenQuery(token));

            return Results.Ok(result);
        });

        // Change password (requires authentication)
        authGroup.MapPost("/change-password", async (ChangePasswordCommand command, IMediator mediator) =>
        {
            var success = await mediator.Send(command);

            if (!success)
            {
                return Results.BadRequest(new { Message = "Current password is invalid or user not found." });
            }

            return Results.Ok(new { Message = "Password changed successfully." });
        }).RequireAuthorization();

        // GET /api/auth/me - return current authenticated user info
        authGroup.MapGet("/me", async (IMediator mediator) =>
        {
            var result = await mediator.Send(new GetMeQuery());
            return result is not null ? Results.Ok(result) : Results.Unauthorized();
        }).RequireAuthorization();

        // PUT /api/auth/me - update current authenticated user profile
        authGroup.MapPut("/me", async (UpdateMeCommand command, IMediator mediator) =>
        {
            var success = await mediator.Send(command);
            return success ? Results.NoContent() : Results.Unauthorized();
        }).RequireAuthorization();

        // PUT /api/auth/me/image - update current authenticated user profile image
        authGroup.MapPut("/me/image", async (HttpRequest request, IMediator mediator) =>
        {
            if (!request.HasFormContentType || !request.Form.Files.Any())
            {
                return Results.BadRequest("No file provided");
            }

            var userId = request.HttpContext.User.GetUserId();
            var file = request.Form.Files[0];

            using var ms = new MemoryStream();
            await file.CopyToAsync(ms);
            var data = ms.ToArray();

            var result = await mediator.Send(new UploadUserImageCommand(userId, data, file.FileName));
            return result is not null ? Results.Ok(result) : Results.BadRequest();
        })
        .RequireAuthorization()
        .DisableAntiforgery();

        return app;
    }
}
