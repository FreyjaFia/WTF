using Microsoft.EntityFrameworkCore;
using System.Collections.Concurrent;
using WTF.Calculations.Subscriptions;
using WTF.Domain.Data;

namespace WTF.Api.Common.Tenancy;

public sealed record TenantPlan(string Name, IReadOnlySet<string> Features);

public interface ITenantFeatures
{
    Task<TenantPlan> GetAsync(WTFDbContext db, Guid tenantId, CancellationToken cancellationToken);

    void Forget();
}

// Remembers which features each shop's plan holds for a few seconds. A shop with no subscription row keeps every feature
// (single-shop installs before the tenants script). Plan edits and plan changes clear it at once.
public sealed class TenantFeatureCache(TimeProvider clock) : ITenantFeatures
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(20);

    private readonly ConcurrentDictionary<Guid, (TenantPlan Plan, DateTimeOffset Expires)> _entries = new();

    public async Task<TenantPlan> GetAsync(WTFDbContext db, Guid tenantId, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        if (_entries.TryGetValue(tenantId, out var entry) && entry.Expires > now)
        {
            return entry.Plan;
        }

        var value = await TenantPlanLookup.LoadAsync(db, tenantId, cancellationToken);
        _entries[tenantId] = (value, now.Add(Lifetime));
        return value;
    }

    public void Forget() => _entries.Clear();
}
