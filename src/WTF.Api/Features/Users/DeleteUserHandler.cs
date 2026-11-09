using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Users;

public record DeleteUserCommand(Guid Id) : IRequest<bool>;

public class DeleteUserHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor, IAuditService auditService, RolePermissionCache permissionCache) : IRequestHandler<DeleteUserCommand, bool>
{
    public async Task<bool> Handle(DeleteUserCommand request, CancellationToken cancellationToken)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == request.Id, cancellationToken);
        if (user == null)
        {
            return false;
        }

        var actorUserId = httpContextAccessor.HttpContext!.User.GetUserId();
        var oldValues = new
        {
            user.FirstName,
            user.LastName,
            user.Username,
            user.RoleId,
            user.IsActive
        };

        await UserRoleGuard.EnsureNotLastOwnerAsync(db, user, cancellationToken);

        // Soft delete - deactivate the user and revoke their sessions
        user.IsActive = false;
        user.UpdatedAt = DateTime.UtcNow;
        user.UpdatedBy = actorUserId;

        var activeRefreshTokens = await db.RefreshTokens
            .Where(rt => rt.UserId == user.Id && !rt.IsRevoked)
            .ToListAsync(cancellationToken);

        foreach (var refreshToken in activeRefreshTokens)
        {
            refreshToken.IsRevoked = true;
        }

        await db.SaveChangesAsync(cancellationToken);
        permissionCache.Forget();

        await auditService.LogAsync(
            action: AuditAction.UserDeleted,
            entityType: AuditEntityType.User,
            entityId: request.Id.ToString(),
            oldValues: oldValues,
            newValues: new
            {
                user.IsActive
            },
            userId: actorUserId,
            cancellationToken: cancellationToken);

        return true;
    }
}
