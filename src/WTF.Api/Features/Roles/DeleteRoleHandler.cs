using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Roles;

public record DeleteRoleCommand(int Id) : IRequest<bool>;

public class DeleteRoleHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    RolePermissionCache permissionCache) : IRequestHandler<DeleteRoleCommand, bool>
{
    public async Task<bool> Handle(DeleteRoleCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        var role = await db.UserRoles.Include(r => r.RolePermissions).FirstOrDefaultAsync(r => r.Id == request.Id, cancellationToken);
        if (role is null)
        {
            return false;
        }

        if (role.TenantId is null)
        {
            throw new InvalidOperationException("Built-in roles cannot be deleted.");
        }

        var userCount = await db.Users.CountAsync(u => u.RoleId == role.Id, cancellationToken);
        if (userCount > 0)
        {
            var who = userCount == 1 ? "1 user has" : $"{userCount} users have";
            throw new InvalidOperationException($"{who} this role. Move them to another role first.");
        }

        var oldValues = new
        {
            role.Name,
            role.Description,
            Permissions = role.RolePermissions.Select(p => p.PermissionKey).Order().ToList()
        };

        db.UserRoles.Remove(role);
        await db.SaveChangesAsync(cancellationToken);
        permissionCache.Forget();

        await auditService.LogAsync(
            action: AuditAction.RoleDeleted,
            entityType: AuditEntityType.Role,
            entityId: role.Id.ToString(),
            oldValues: oldValues,
            userId: userId,
            cancellationToken: cancellationToken);

        return true;
    }
}
