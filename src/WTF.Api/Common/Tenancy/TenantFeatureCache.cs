using Microsoft.EntityFrameworkCore;
using System.Collections.Concurrent;
using WTF.Domain.Data;

namespace WTF.Api.Common.Tenancy;

public sealed record TenantPlan(string Name, IReadOnlySet<string> Features, int? MaxUsers = null, int? MaxBranches = null);

public interface ITenantFeatures
{
    Task<TenantPlan> GetAsync(WTFDbContext db, Guid tenantId, CancellationToken cancellationToken);

    void Forget();

    void Forget(Guid tenantId);
}

// Remembers which features each shop's plan holds for a few seconds. A shop with no subscription row keeps every feature
// (single-shop installs before the tenants script). A plan edit or plan change forgets what it touched at once, but only
// in this process: another API instance keeps its own copy until Lifetime passes, so a downgrade can take that long there.
public sealed class TenantFeatureCache(TimeProvider clock) : ITenantFeatures
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(20);

    private const int PruneAbove = 512;

    private readonly ConcurrentDictionary<Guid, (TenantPlan Plan, DateTimeOffset Expires)> _entries = new();
    private readonly ConcurrentDictionary<Guid, long> _generations = new();

    private long _epoch;

    public async Task<TenantPlan> GetAsync(WTFDbContext db, Guid tenantId, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        if (_entries.TryGetValue(tenantId, out var entry) && entry.Expires > now)
        {
            return entry.Plan;
        }

        var stamp = StampOf(tenantId);
        var value = await TenantPlanLookup.LoadAsync(db, tenantId, cancellationToken);

        // A Forget that ran while this read was in flight means the value may be the old plan: use it once, do not keep it.
        if (stamp == StampOf(tenantId))
        {
            _entries[tenantId] = (value, now.Add(Lifetime));
            Prune(now);
        }

        return value;
    }

    public void Forget()
    {
        Interlocked.Increment(ref _epoch);
        _entries.Clear();
    }

    public void Forget(Guid tenantId)
    {
        _generations.AddOrUpdate(tenantId, 1, (_, value) => value + 1);
        _entries.TryRemove(tenantId, out _);
    }

    private long StampOf(Guid tenantId) => Volatile.Read(ref _epoch) + _generations.GetValueOrDefault(tenantId);

    private void Prune(DateTimeOffset now)
    {
        if (_entries.Count <= PruneAbove)
        {
            return;
        }

        foreach (var (key, entry) in _entries)
        {
            if (entry.Expires <= now)
            {
                _entries.TryRemove(key, out _);
            }
        }
    }
}
