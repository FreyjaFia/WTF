using MediatR;
using WTF.Api.Common.Auth;
using WTF.Contracts.Users.Commands;
using WTF.Contracts.Users.Queries;

namespace WTF.Api.Endpoints;

public static class UserEndpoints
{
    private static readonly string[] imageTypes = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

    public static IEndpointRouteBuilder MapUsers(this IEndpointRouteBuilder app)
    {
        var userGroup = app.MapGroup("/api/users")
            .RequireAuthorization();

        // GET /api/users - Get all users (with pagination and search)
        userGroup.MapGet("/",
            async ([AsParameters] GetUsersQuery query, ISender sender) =>
            {
                var result = await sender.Send(query);
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.ManagementRead);

        // GET /api/users/{id} - Get user by ID
        userGroup.MapGet("/{id:guid}",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new GetUserByIdQuery(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ManagementRead)
            .WithName("GetUserById");

        // POST /api/users - Create new user
        userGroup.MapPost("/",
            async (CreateUserCommand command, ISender sender) =>
            {
                var result = await sender.Send(command);
                return Results.CreatedAtRoute("GetUserById", new { id = result.Id }, result);
            })
            .RequireAuthorization(AppPolicies.ManagementWrite);

        // PUT /api/users/{id} - Update user
        userGroup.MapPut("/{id:guid}",
            async (Guid id, UpdateUserCommand command, ISender sender) =>
            {
                if (id != command.Id)
                {
                    return Results.BadRequest("ID mismatch");
                }
                var result = await sender.Send(command);
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ManagementWrite);

        // DELETE /api/users/{id} - Delete user
        userGroup.MapDelete("/{id:guid}",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new DeleteUserCommand(id));
                return result ? Results.NoContent() : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ManagementWrite);

        // POST /api/users/{id}/images - Upload user image
        userGroup.MapPost("/{id:guid}/images",
            async (Guid id, IFormFile file, ISender sender) =>
            {
                if (file == null || file.Length == 0)
                {
                    return Results.BadRequest("No file uploaded");
                }

                // Validate file type (only images)
                var allowedExtensions = imageTypes;
                var extension = Path.GetExtension(file.FileName).ToLowerInvariant();

                if (!allowedExtensions.Contains(extension))
                {
                    return Results.BadRequest("Invalid file type. Only image files are allowed.");
                }

                // Validate file size (max 5MB)
                if (file.Length > 5 * 1024 * 1024)
                {
                    return Results.BadRequest("File size exceeds 5MB limit.");
                }

                using var memoryStream = new MemoryStream();
                await file.CopyToAsync(memoryStream);
                var imageData = memoryStream.ToArray();

                var command = new UploadUserImageCommand(id, imageData, file.FileName);
                var result = await sender.Send(command);

                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ManagementWrite)
            .DisableAntiforgery();

        return app;
    }
}
