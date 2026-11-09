using MediatR;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Roles.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Roles;

public record CreateRoleCommand(string Name, string? Description, List<string>? Permissions) : IRequest<RoleDetailDto>;

public class CreateRoleHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    RolePermissionCache permissionCache) : IRequestHandler<CreateRoleCommand, RoleDetailDto>
{
    public async Task<RoleDetailDto> Handle(CreateRoleCommand request, CancellationToken cancellationToken)
    {
        var principal = httpContextAccessor.HttpContext!.User;
        var userId = principal.GetUserId();

        var name = RoleRules.CleanName(request.Name);
        var description = RoleRules.CleanDescription(request.Description);
        var keys = RoleRules.ValidKeys(request.Permissions);
        RoleRules.EnsureHolds(principal, keys);
        await RoleRules.EnsureNameFreeAsync(db, name, null, cancellationToken);

        var role = new UserRole
        {
            Id = await RoleRules.NextRoleIdAsync(db, cancellationToken),
            Name = name,
            Description = description,
            TenantId = RoleRules.CurrentTenant(db),
            IsSystem = false,
            CreatedAt = DateTime.UtcNow,
            RolePermissions = [.. keys.Select(k => new RolePermission { PermissionKey = k })]
        };

        db.UserRoles.Add(role);
        await db.SaveChangesAsync(cancellationToken);
        permissionCache.Forget();

        await auditService.LogAsync(
            action: AuditAction.RoleCreated,
            entityType: AuditEntityType.Role,
            entityId: role.Id.ToString(),
            newValues: new { role.Name, role.Description, Permissions = keys.Order().ToList() },
            userId: userId,
            cancellationToken: cancellationToken);

        return new RoleDetailDto(role.Id, role.Name, role.Description, false, 0, [.. keys.Order()]);
    }
}
