using Microsoft.EntityFrameworkCore;
using System.Collections.Concurrent;
using WTF.Domain.Data;

namespace WTF.Api.Common.Tenancy;

// Remembers each shop's status for a few seconds so a suspended shop is locked out without a query on every request.
public sealed class TenantStatusCache(TimeProvider clock)
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(20);

    private readonly ConcurrentDictionary<Guid, (byte Status, DateTimeOffset Expires)> _entries = new();

    public async Task<bool> CanUseAsync(WTFDbContext db, Guid tenantId, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        if (_entries.TryGetValue(tenantId, out var entry) && entry.Expires > now)
        {
            return TenantAccess.CanUse(entry.Status);
        }

        var status = await db.Tenants
            .AsNoTracking()
            .Where(t => t.Id == tenantId)
            .Select(t => (byte?)t.Status)
            .FirstOrDefaultAsync(cancellationToken);

        var value = status ?? TenantAccess.Active;
        _entries[tenantId] = (value, now.Add(Lifetime));
        return TenantAccess.CanUse(value);
    }

    public void Forget(Guid tenantId) => _entries.TryRemove(tenantId, out _);
}
