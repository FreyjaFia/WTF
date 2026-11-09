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

public record DuplicateRoleCommand(int Id) : IRequest<RoleDetailDto?>;

public class DuplicateRoleHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    RolePermissionCache permissionCache) : IRequestHandler<DuplicateRoleCommand, RoleDetailDto?>
{
    public async Task<RoleDetailDto?> Handle(DuplicateRoleCommand request, CancellationToken cancellationToken)
    {
        var principal = httpContextAccessor.HttpContext!.User;
        var userId = principal.GetUserId();

        var source = await db.UserRoles.AsNoTracking().FirstOrDefaultAsync(r => r.Id == request.Id, cancellationToken);
        if (source is null)
        {
            return null;
        }

        var keys = await RoleRules.KeysOfAsync(db, source, cancellationToken);
        RoleRules.EnsureHolds(principal, keys);

        var copyName = await FreeCopyNameAsync(source.Name, cancellationToken);
        var role = new UserRole
        {
            Id = await RoleRules.NextRoleIdAsync(db, cancellationToken),
            Name = copyName,
            Description = source.Description,
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
            newValues: new { role.Name, role.Description, Permissions = keys.Order().ToList(), DuplicatedFrom = source.Name },
            userId: userId,
            cancellationToken: cancellationToken);

        return new RoleDetailDto(role.Id, role.Name, role.Description, false, 0, [.. keys.Order()]);
    }

    private async Task<string> FreeCopyNameAsync(string sourceName, CancellationToken cancellationToken)
    {
        var existing = (await db.UserRoles.Select(r => r.Name).ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        for (var number = 1; ; number++)
        {
            var suffix = number == 1 ? " copy" : $" copy {number}";
            var candidate = sourceName.Length + suffix.Length > RoleRules.MaxNameLength
                ? sourceName[..(RoleRules.MaxNameLength - suffix.Length)] + suffix
                : sourceName + suffix;

            if (!existing.Contains(candidate))
            {
                return candidate;
            }
        }
    }
}
