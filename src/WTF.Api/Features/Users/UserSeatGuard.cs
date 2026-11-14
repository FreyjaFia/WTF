using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Calculations.Subscriptions;
using WTF.Domain.Data;
using WTF.Domain.Tenancy;

namespace WTF.Api.Features.Users;

public static class UserSeatGuard
{
    public const string UserLimitCode = "plan_user_limit";

    // Single-shop installs and shops without a subscription row are never limited.
    public static async Task<int?> MaxUsersAsync(WTFDbContext db, ICurrentTenant currentTenant, CancellationToken cancellationToken)
    {
        if (!currentTenant.FilterEnabled || currentTenant.TenantId is not { } tenantId)
        {
            return null;
        }

        return await db.TenantSubscriptions
            .AsNoTracking()
            .Where(s => s.TenantId == tenantId)
            .Select(s => s.Plan.MaxUsers)
            .FirstOrDefaultAsync(cancellationToken);
    }

    public static Task<int> CountActiveAsync(WTFDbContext db, CancellationToken cancellationToken) =>
        db.Users.AsNoTracking().CountAsync(u => u.IsActive, cancellationToken);

    public static async Task EnsureSeatAvailableAsync(WTFDbContext db, ICurrentTenant currentTenant, CancellationToken cancellationToken)
    {
        var maxUsers = await MaxUsersAsync(db, currentTenant, cancellationToken);
        if (maxUsers is null)
        {
            return;
        }

        var active = await CountActiveAsync(db, cancellationToken);
        if (!UserCapRules.CanAddUser(active, maxUsers))
        {
            throw new ForbiddenActionException($"Your plan allows {maxUsers} active users. Deactivate a user or move to a bigger plan to add more.", UserLimitCode);
        }
    }
}
