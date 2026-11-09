using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Roles.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Roles;

public record UpdateRoleCommand(int Id, string Name, string? Description, List<string>? Permissions) : IRequest<RoleDetailDto?>;

public class UpdateRoleHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    RolePermissionCache permissionCache) : IRequestHandler<UpdateRoleCommand, RoleDetailDto?>
{
    public async Task<RoleDetailDto?> Handle(UpdateRoleCommand request, CancellationToken cancellationToken)
    {
        var principal = httpContextAccessor.HttpContext!.User;
        var userId = principal.GetUserId();

        var role = await db.UserRoles.Include(r => r.RolePermissions).FirstOrDefaultAsync(r => r.Id == request.Id, cancellationToken);
        if (role is null)
        {
            return null;
        }

        if (role.TenantId is null)
        {
            throw new InvalidOperationException("Built-in roles cannot be changed. Duplicate it to make your own version.");
        }

        var name = RoleRules.CleanName(request.Name);
        var description = RoleRules.CleanDescription(request.Description);
        var newKeys = RoleRules.ValidKeys(request.Permissions);
        var oldKeys = PermissionRules.Normalize(role.RolePermissions.Select(p => p.PermissionKey));

        RoleRules.EnsureHolds(principal, oldKeys);
        RoleRules.EnsureHolds(principal, newKeys);
        await RoleRules.EnsureNameFreeAsync(db, name, role.Id, cancellationToken);

        var oldValues = new { role.Name, role.Description, Permissions = oldKeys.Order().ToList() };

        role.Name = name;
        role.Description = description;
        db.RolePermissions.RemoveRange(role.RolePermissions.Where(p => !newKeys.Contains(p.PermissionKey)));
        foreach (var key in newKeys.Where(k => role.RolePermissions.All(p => p.PermissionKey != k)))
        {
            role.RolePermissions.Add(new RolePermission { PermissionKey = key });
        }

        await db.SaveChangesAsync(cancellationToken);
        permissionCache.Forget();

        await auditService.LogAsync(
            action: AuditAction.RoleUpdated,
            entityType: AuditEntityType.Role,
            entityId: role.Id.ToString(),
            oldValues: oldValues,
            newValues: new
            {
                role.Name,
                role.Description,
                Permissions = newKeys.Order().ToList(),
                Added = newKeys.Except(oldKeys).Order().ToList(),
                Removed = oldKeys.Except(newKeys).Order().ToList()
            },
            userId: userId,
            cancellationToken: cancellationToken);

        var userCount = await db.Users.CountAsync(u => u.RoleId == role.Id, cancellationToken);
        return new RoleDetailDto(role.Id, role.Name, role.Description, false, userCount, [.. newKeys.Order()]);
    }
}
