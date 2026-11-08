using Microsoft.EntityFrameworkCore;
using WTF.Domain.Data;

namespace WTF.Api.Common.Tenancy;

public static class TenantAccess
{
    public const byte Trial = 1;
    public const byte Active = 2;
    public const byte Suspended = 3;
    public const byte Cancelled = 4;

    public const string SuspendedMessage = "This shop's account is suspended. Please contact support.";

    public static bool CanUse(byte status) => status is Trial or Active;

    public static async Task<bool> IsActiveAsync(WTFDbContext db, Guid tenantId, CancellationToken cancellationToken)
    {
        var status = await db.Tenants
            .AsNoTracking()
            .Where(t => t.Id == tenantId)
            .Select(t => (byte?)t.Status)
            .FirstOrDefaultAsync(cancellationToken);

        return status is { } value && CanUse(value);
    }

    public static async Task EnsureActiveAsync(WTFDbContext db, Guid tenantId, CancellationToken cancellationToken)
    {
        if (!await IsActiveAsync(db, tenantId, cancellationToken))
        {
            throw new InvalidOperationException(SuspendedMessage);
        }
    }
}
