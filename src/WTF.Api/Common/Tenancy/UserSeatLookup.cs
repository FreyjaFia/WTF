using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Calculations.Subscriptions;
using WTF.Domain.Data;

namespace WTF.Api.Common.Tenancy;

public static class UserSeatLookup
{
    public const string UserBlockedCode = "plan_user_blocked";

    public const string UserBlockedMessage = "Your shop's plan allows fewer users than it has. Ask the owner to deactivate a user or move to a bigger plan to restore your access.";

    public static async Task<IReadOnlySet<Guid>> BlockedIdsAsync(WTFDbContext db, Guid tenantId, int? maxUsers, CancellationToken cancellationToken)
    {
        if (maxUsers is null)
        {
            return new HashSet<Guid>();
        }

        var users = await db.Users
            .AsNoTracking()
            .IgnoreQueryFilters()
            .Where(u => u.TenantId == tenantId && u.IsActive)
            .Select(u => new { u.Id, u.RoleId, u.CreatedAt })
            .ToListAsync(cancellationToken);

        var ownerRoleIds = await db.UserRoles
            .AsNoTracking()
            .IgnoreQueryFilters()
            .Where(r => r.TenantId == null && r.Name == AppRoles.Owner)
            .Select(r => r.Id)
            .ToListAsync(cancellationToken);

        return UserCapRules.BlockedUserIds(users.Select(u => new SeatCandidate(u.Id, ownerRoleIds.Contains(u.RoleId), u.CreatedAt)), maxUsers);
    }

    public static async Task EnsureNotBlockedAsync(WTFDbContext db, Guid tenantId, Guid userId, CancellationToken cancellationToken)
    {
        var plan = await TenantPlanLookup.LoadAsync(db, tenantId, cancellationToken);
        if ((await BlockedIdsAsync(db, tenantId, plan.MaxUsers, cancellationToken)).Contains(userId))
        {
            throw new ForbiddenActionException(UserBlockedMessage, UserBlockedCode);
        }
    }
}
