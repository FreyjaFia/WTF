using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using WTF.Api.Features.Roles;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Users;

internal static class UserRoleGuard
{
    public const string OwnerRoleName = "Owner";

    // The role must be one the shop can see, and the person assigning it must hold every permission it carries.
    public static async Task<UserRole> EnsureAssignableAsync(WTFDbContext db, ClaimsPrincipal actor, int roleId, CancellationToken cancellationToken)
    {
        var role = await db.UserRoles.AsNoTracking().FirstOrDefaultAsync(r => r.Id == roleId, cancellationToken)
            ?? throw new InvalidOperationException("Choose one of the listed roles.");

        var keys = await RoleRules.KeysOfAsync(db, role, cancellationToken);
        RoleRules.EnsureHolds(actor, keys);

        return role;
    }

    public static async Task EnsureNotLastOwnerAsync(WTFDbContext db, User user, CancellationToken cancellationToken)
    {
        var ownerRoleId = await db.UserRoles
            .Where(r => r.TenantId == null && r.Name == OwnerRoleName)
            .Select(r => (int?)r.Id)
            .FirstOrDefaultAsync(cancellationToken);

        if (ownerRoleId is null || user.RoleId != ownerRoleId)
        {
            return;
        }

        var otherOwners = await db.Users.AnyAsync(u => u.Id != user.Id && u.RoleId == ownerRoleId && u.IsActive, cancellationToken);
        if (!otherOwners)
        {
            throw new InvalidOperationException("The shop needs at least one active owner.");
        }
    }
}
