using MediatR;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Users;
using WTF.Api.Features.Users.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Endpoints;

public static class UserEndpoints
{

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
            .RequireAuthorization(AppPolicies.UsersRead);

        // GET /api/users/{id} - Get user by ID
        userGroup.MapGet("/{id:guid}",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new GetUserByIdQuery(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.UsersRead)
            .WithName("GetUserById");

        // POST /api/users - Create new user
        userGroup.MapPost("/",
            async (CreateUserCommand command, ISender sender) =>
            {
                var result = await sender.Send(command);
                return Results.CreatedAtRoute("GetUserById", new { id = result.Id }, result);
            })
            .RequireAuthorization(AppPolicies.UsersWrite);

        // PUT /api/users/{id} - Update user
        userGroup.MapPut("/{id:guid}",
            async (Guid id, UpdateUserCommand command, ISender sender, WTFDbContext db, HttpContext httpContext) =>
            {
                if (id != command.Id)
                {
                    return Results.BadRequest("ID mismatch");
                }

                var targetUser = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id);
                if (targetUser == null)
                {
                    return Results.NotFound();
                }

                var isCurrentUserSuperAdmin = httpContext.User.IsInRole(AppRoles.SuperAdmin);
                var isTargetUserSuperAdmin = targetUser.RoleId == (int)UserRoleEnum.SuperAdmin;

                if ((isTargetUserSuperAdmin || command.RoleId == UserRoleEnum.SuperAdmin) && !isCurrentUserSuperAdmin)
                {
                    return Results.Forbid();
                }

                var result = await sender.Send(command);
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.UsersWrite);

        // DELETE /api/users/{id} - Delete user
        userGroup.MapDelete("/{id:guid}",
            async (Guid id, ISender sender, WTFDbContext db, HttpContext httpContext) =>
            {
                var targetUser = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id);
                if (targetUser == null)
                {
                    return Results.NotFound();
                }

                var isCurrentUserSuperAdmin = httpContext.User.IsInRole(AppRoles.SuperAdmin);
                var isTargetUserSuperAdmin = targetUser.RoleId == (int)UserRoleEnum.SuperAdmin;
                if (isTargetUserSuperAdmin && !isCurrentUserSuperAdmin)
                {
                    return Results.Forbid();
                }

                var result = await sender.Send(new DeleteUserCommand(id));
                return result ? Results.NoContent() : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.UsersWrite);

        // POST /api/users/{id}/restore - Restore soft deleted user
        userGroup.MapPost("/{id:guid}/restore",
            async (Guid id, ISender sender, WTFDbContext db, HttpContext httpContext) =>
            {
                var targetUser = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id);
                if (targetUser == null)
                {
                    return Results.NotFound();
                }

                var isCurrentUserSuperAdmin = httpContext.User.IsInRole(AppRoles.SuperAdmin);
                var isTargetUserSuperAdmin = targetUser.RoleId == (int)UserRoleEnum.SuperAdmin;
                if (isTargetUserSuperAdmin && !isCurrentUserSuperAdmin)
                {
                    return Results.Forbid();
                }

                var result = await sender.Send(new RestoreUserCommand(id));
                return result ? Results.NoContent() : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.UsersWrite);

        // POST /api/users/{id}/images - Upload user image
        userGroup.MapPost("/{id:guid}/images",
            async (Guid id, IFormFile file, ISender sender, WTFDbContext db, HttpContext httpContext) =>
            {
                if (file == null || file.Length == 0)
                {
                    return Results.BadRequest("No file uploaded");
                }

                var targetUser = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id);
                if (targetUser == null)
                {
                    return Results.NotFound();
                }

                var isCurrentUserSuperAdmin = httpContext.User.IsInRole(AppRoles.SuperAdmin);
                var isTargetUserSuperAdmin = targetUser.RoleId == (int)UserRoleEnum.SuperAdmin;
                if (isTargetUserSuperAdmin && !isCurrentUserSuperAdmin)
                {
                    return Results.Forbid();
                }

                // The size is checked before the file is read; the real type and contents are checked by the handler (ImageUploads).
                var imageData = await ImageUploads.ReadAsync(file);

                var command = new UploadUserImageCommand(id, imageData, file.FileName);
                var result = await sender.Send(command);

                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.UsersWrite)
            .WithMetadata(new RequestSizeLimitAttribute(ImageUploads.RequestLimit))
            .DisableAntiforgery();

        // DELETE /api/users/{id}/images - Remove user image
        userGroup.MapDelete("/{id:guid}/images",
            async (Guid id, ISender sender, WTFDbContext db, HttpContext httpContext) =>
            {
                var targetUser = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id);
                if (targetUser == null)
                {
                    return Results.NotFound();
                }

                var isCurrentUserSuperAdmin = httpContext.User.IsInRole(AppRoles.SuperAdmin);
                var isTargetUserSuperAdmin = targetUser.RoleId == (int)UserRoleEnum.SuperAdmin;
                if (isTargetUserSuperAdmin && !isCurrentUserSuperAdmin)
                {
                    return Results.Forbid();
                }

                var result = await sender.Send(new RemoveUserImageCommand(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.UsersWrite);

        return app;
    }
}
