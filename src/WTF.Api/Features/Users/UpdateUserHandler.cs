using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Users.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Users;

public record UpdateUserCommand(Guid Id, string FirstName, string LastName, string Username, string? Password, int RoleId) : IRequest<UserDto?>;

public class UpdateUserHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor, IAuditService auditService, RolePermissionCache permissionCache) : IRequestHandler<UpdateUserCommand, UserDto?>
{
    public async Task<UserDto?> Handle(UpdateUserCommand request, CancellationToken cancellationToken)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == request.Id, cancellationToken);
        if (user == null)
        {
            return null;
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var oldValues = new
        {
            user.FirstName,
            user.LastName,
            user.Username,
            user.RoleId,
            user.IsActive
        };
        var isPasswordChanged = !string.IsNullOrWhiteSpace(request.Password);

        UserValidation.EnsureValidNames(request.FirstName, request.LastName);
        UserValidation.EnsureValidUsername(request.Username);
        UserValidation.EnsureValidPassword(request.Password, isUpdate: true);
        await UserValidation.EnsureUniqueUsernameAsync(db, request.Username, user.Id, cancellationToken);

        var roleChanged = user.RoleId != request.RoleId;
        UserRole role;
        if (roleChanged)
        {
            if (user.Id == userId)
            {
                throw new ForbiddenActionException("You cannot change your own role.");
            }

            role = await UserRoleGuard.EnsureAssignableAsync(db, httpContextAccessor.HttpContext!.User, request.RoleId, cancellationToken);
            await UserRoleGuard.EnsureNotLastOwnerAsync(db, user, cancellationToken);
        }
        else
        {
            role = await db.UserRoles.AsNoTracking().FirstAsync(r => r.Id == user.RoleId, cancellationToken);
        }

        user.FirstName = request.FirstName;
        user.LastName = request.LastName;
        user.Username = request.Username;
        user.RoleId = role.Id;
        user.UpdatedAt = DateTime.UtcNow;
        user.UpdatedBy = userId;

        if (!string.IsNullOrWhiteSpace(request.Password))
        {
            user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password);
        }

        await db.SaveChangesAsync(cancellationToken);
        permissionCache.Forget();

        await auditService.LogAsync(
            action: AuditAction.UserUpdated,
            entityType: AuditEntityType.User,
            entityId: user.Id.ToString(),
            oldValues: oldValues,
            newValues: new
            {
                user.FirstName,
                user.LastName,
                user.Username,
                user.RoleId,
                user.IsActive,
                IsPasswordChanged = isPasswordChanged
            },
            userId: userId,
            cancellationToken: cancellationToken);

        if (roleChanged)
        {
            await auditService.LogAsync(
                action: AuditAction.UserRoleChanged,
                entityType: AuditEntityType.User,
                entityId: user.Id.ToString(),
                oldValues: new { RoleId = oldValues.RoleId },
                newValues: new { RoleId = role.Id, RoleName = role.Name },
                userId: userId,
                cancellationToken: cancellationToken);
        }

        return UserMapping.ToDto(user, null, role.Name);
    }
}
