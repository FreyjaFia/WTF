using Microsoft.EntityFrameworkCore;
using System.Collections.Concurrent;
using WTF.Domain.Data;

namespace WTF.Api.Common.Auth.Permissions;

public sealed record UserAccess(bool IsActive, int RoleId, string RoleName, bool IsSystemRole, IReadOnlySet<string> Keys, IReadOnlySet<string> KnownRoleNames)
{
    public static readonly UserAccess None = new(false, 0, string.Empty, false, new HashSet<string>(), new HashSet<string>());
}

// Remembers what each user may do (their current role and its permission keys) for a few seconds, so a role change takes
// effect on the user's next action without a query on every request. Editing a role or a user's role clears it at once.
public sealed class RolePermissionCache(TimeProvider clock)
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(20);

    private readonly ConcurrentDictionary<Guid, (UserAccess Access, DateTimeOffset Expires)> _entries = new();

    public async Task<UserAccess> GetAsync(WTFDbContext db, Guid userId, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        if (_entries.TryGetValue(userId, out var entry) && entry.Expires > now)
        {
            return entry.Access;
        }

        var access = await LoadAsync(db, userId, cancellationToken);
        _entries[userId] = (access, now.Add(Lifetime));
        return access;
    }

    public void Forget() => _entries.Clear();

    public static async Task<UserAccess> LoadAsync(WTFDbContext db, Guid userId, CancellationToken cancellationToken)
    {
        var user = await db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => new { u.IsActive, u.RoleId, u.TenantId })
            .FirstOrDefaultAsync(cancellationToken);

        if (user is null || !user.IsActive)
        {
            return UserAccess.None;
        }

        var visibleRoles = await db.UserRoles
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(r => r.TenantId == null || r.TenantId == user.TenantId)
            .Select(r => new { r.Id, r.Name, IsSystem = r.TenantId == null })
            .ToListAsync(cancellationToken);

        var role = visibleRoles.FirstOrDefault(r => r.Id == user.RoleId);
        if (role is null)
        {
            return UserAccess.None;
        }

        var known = visibleRoles.Select(r => r.Name).ToHashSet();
        if (role.IsSystem && SystemRolePermissions.Bundles.TryGetValue(role.Name, out var bundle))
        {
            return new UserAccess(true, role.Id, role.Name, true, bundle.ToHashSet(), known);
        }

        var stored = await db.RolePermissions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(p => p.RoleId == role.Id)
            .Select(p => p.PermissionKey)
            .ToListAsync(cancellationToken);

        return new UserAccess(true, role.Id, role.Name, false, PermissionRules.Normalize(stored), known);
    }
}
