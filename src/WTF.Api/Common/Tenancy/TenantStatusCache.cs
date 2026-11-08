using Microsoft.EntityFrameworkCore;
using System.Collections.Concurrent;
using WTF.Calculations.Subscriptions;
using WTF.Domain.Data;

namespace WTF.Api.Common.Tenancy;

// Remembers each shop's status (and when its paid time and grace end) for a few seconds so a suspended or lapsed shop is
// stopped without a query on every request.
public sealed class TenantStatusCache(TimeProvider clock)
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(20);

    private readonly ConcurrentDictionary<Guid, (byte Status, DateTime? AccessUntil, DateTimeOffset Expires)> _entries = new();

    public async Task<bool> CanUseAsync(WTFDbContext db, Guid tenantId, CancellationToken cancellationToken) =>
        TenantAccess.CanUse((await GetAsync(db, tenantId, cancellationToken)).Status);

    // Paid time is over and so is the grace: reads still work (export, history) but nothing new may be saved.
    public async Task<bool> IsLapsedAsync(WTFDbContext db, Guid tenantId, CancellationToken cancellationToken)
    {
        var entry = await GetAsync(db, tenantId, cancellationToken);
        return entry.AccessUntil is { } until && clock.GetUtcNow().UtcDateTime >= until;
    }

    public void Forget(Guid tenantId) => _entries.TryRemove(tenantId, out _);

    private async Task<(byte Status, DateTime? AccessUntil)> GetAsync(WTFDbContext db, Guid tenantId, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        if (_entries.TryGetValue(tenantId, out var entry) && entry.Expires > now)
        {
            return (entry.Status, entry.AccessUntil);
        }

        var status = await db.Tenants
            .AsNoTracking()
            .Where(t => t.Id == tenantId)
            .Select(t => (byte?)t.Status)
            .FirstOrDefaultAsync(cancellationToken);

        var subscription = await db.TenantSubscriptions
            .AsNoTracking()
            .Where(s => s.TenantId == tenantId)
            .Select(s => new { s.CurrentPeriodEnd, s.GraceDays })
            .FirstOrDefaultAsync(cancellationToken);

        var value = status ?? TenantAccess.Active;
        DateTime? accessUntil = subscription is null ? null : SubscriptionRules.AccessUntil(subscription.CurrentPeriodEnd, subscription.GraceDays);
        _entries[tenantId] = (value, accessUntil, now.Add(Lifetime));
        return (value, accessUntil);
    }
}
