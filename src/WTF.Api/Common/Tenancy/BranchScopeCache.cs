using Microsoft.EntityFrameworkCore;
using System.Collections.Concurrent;
using WTF.Api.Features.Branches.Enums;
using WTF.Domain.Data;

namespace WTF.Api.Common.Tenancy;

public sealed record BranchInfo(Guid Id, bool IsActive, bool IsMain);

public sealed record UserBranchScope(bool IsAll, IReadOnlySet<Guid> Assigned, Guid? DefaultBranchId);

// Remembers each user's branch scope and each shop's branch list for a few seconds, so a changed assignment or a closed branch
// reaches the next request without a query on every request. Branch and assignment changes clear it at once.
public sealed class BranchScopeCache(TimeProvider clock)
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(20);

    private readonly ConcurrentDictionary<Guid, (UserBranchScope Scope, DateTimeOffset Expires)> _users = new();
    private readonly ConcurrentDictionary<Guid, (IReadOnlyList<BranchInfo> Branches, DateTimeOffset Expires)> _tenants = new();

    public async Task<UserBranchScope> GetUserAsync(WTFDbContext db, Guid userId, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        if (_users.TryGetValue(userId, out var entry) && entry.Expires > now)
        {
            return entry.Scope;
        }

        var user = await db.Users.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => new { u.BranchScope, u.DefaultBranchId })
            .FirstOrDefaultAsync(cancellationToken);

        var assigned = await db.UserBranches.AsNoTracking()
            .Where(b => b.UserId == userId)
            .Select(b => b.BranchId)
            .ToListAsync(cancellationToken);

        var scope = new UserBranchScope(user is null || user.BranchScope == (byte)BranchScopeEnum.All, assigned.ToHashSet(), user?.DefaultBranchId);
        _users[userId] = (scope, now.Add(Lifetime));
        return scope;
    }

    public async Task<IReadOnlyList<BranchInfo>> GetBranchesAsync(WTFDbContext db, Guid tenantId, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        if (_tenants.TryGetValue(tenantId, out var entry) && entry.Expires > now)
        {
            return entry.Branches;
        }

        var branches = await db.Branches.IgnoreQueryFilters().AsNoTracking()
            .Where(b => b.TenantId == tenantId)
            .OrderByDescending(b => b.IsMain).ThenBy(b => b.Name)
            .Select(b => new BranchInfo(b.Id, b.IsActive, b.IsMain))
            .ToListAsync(cancellationToken);

        _tenants[tenantId] = (branches, now.Add(Lifetime));
        return branches;
    }

    public void Forget()
    {
        _users.Clear();
        _tenants.Clear();
    }
}
