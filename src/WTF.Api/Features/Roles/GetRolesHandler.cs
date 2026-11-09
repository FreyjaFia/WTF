using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Features.Roles.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Roles;

public record GetRolesQuery : IRequest<List<RoleDto>>;

public class GetRolesHandler(WTFDbContext db) : IRequestHandler<GetRolesQuery, List<RoleDto>>
{
    public async Task<List<RoleDto>> Handle(GetRolesQuery request, CancellationToken cancellationToken)
    {
        var roles = await db.UserRoles
            .AsNoTracking()
            .Select(r => new { r.Id, r.Name, r.Description, r.TenantId, r.CreatedAt })
            .ToListAsync(cancellationToken);

        var userCounts = await db.Users
            .AsNoTracking()
            .GroupBy(u => u.RoleId)
            .Select(g => new { RoleId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.RoleId, g => g.Count, cancellationToken);

        var stored = (await db.RolePermissions
            .AsNoTracking()
            .Select(p => new { p.RoleId, p.PermissionKey })
            .ToListAsync(cancellationToken))
            .GroupBy(p => p.RoleId)
            .ToDictionary(g => g.Key, g => PermissionRules.Normalize(g.Select(p => p.PermissionKey)));

        return [.. roles
            .Select(r =>
            {
                var isSystem = r.TenantId is null;
                List<string> permissions = isSystem
                    ? [.. SystemRolePermissions.Bundles.GetValueOrDefault(r.Name) ?? []]
                    : [.. stored.GetValueOrDefault(r.Id) ?? []];
                permissions.Sort(StringComparer.Ordinal);

                return new RoleDto(
                    r.Id,
                    r.Name,
                    r.Description,
                    isSystem,
                    userCounts.GetValueOrDefault(r.Id),
                    permissions.Count,
                    r.CreatedAt,
                    permissions);
            })
            .OrderByDescending(r => r.IsSystem)
            .ThenBy(r => r.Name)];
    }
}
