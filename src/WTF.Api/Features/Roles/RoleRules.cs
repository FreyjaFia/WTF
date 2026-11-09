using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Auth.Permissions;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Roles;

internal static class RoleRules
{
    public const int MaxNameLength = 50;
    public const int MaxDescriptionLength = 200;
    public const int FirstCustomRoleId = 100;

    private static readonly string[] ReservedNames = [.. SystemRolePermissions.Bundles.Keys, AppRoles.PlatformAdmin, "SuperAdmin"];

    public static string CleanName(string? name)
    {
        var cleaned = (name ?? string.Empty).Trim();
        if (cleaned.Length == 0)
        {
            throw new InvalidOperationException("Role name is required.");
        }

        if (cleaned.Length > MaxNameLength)
        {
            throw new InvalidOperationException($"Role name can be at most {MaxNameLength} characters.");
        }

        if (ReservedNames.Contains(cleaned, StringComparer.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("That name belongs to a built-in role. Choose another name.");
        }

        return cleaned;
    }

    public static string? CleanDescription(string? description)
    {
        var cleaned = description?.Trim();
        if (string.IsNullOrEmpty(cleaned))
        {
            return null;
        }

        if (cleaned.Length > MaxDescriptionLength)
        {
            throw new InvalidOperationException($"Description can be at most {MaxDescriptionLength} characters.");
        }

        return cleaned;
    }

    public static async Task EnsureNameFreeAsync(WTFDbContext db, string name, int? excludeRoleId, CancellationToken cancellationToken)
    {
        var lowered = name.ToLower();
        var taken = await db.UserRoles.AnyAsync(
            r => r.Name.ToLower() == lowered && (!excludeRoleId.HasValue || r.Id != excludeRoleId.Value),
            cancellationToken);

        if (taken)
        {
            throw new InvalidOperationException("A role with that name already exists.");
        }
    }

    // Every key must exist; the result also holds what the keys require.
    public static HashSet<string> ValidKeys(IEnumerable<string>? permissions)
    {
        var requested = (permissions ?? []).Select(k => k.Trim()).Where(k => k.Length > 0).Distinct().ToList();
        var unknown = requested.Where(k => !PermissionRules.IsKnown(k)).ToList();
        if (unknown.Count > 0)
        {
            throw new InvalidOperationException($"Unknown permission: {string.Join(", ", unknown)}.");
        }

        return PermissionRules.Normalize(requested);
    }

    // Nobody can give or edit what they do not hold themselves. The owner role holds everything, so it is never limited.
    // A role "holds" a key even when the shop's plan switches it off, so plan-locked keys neither block editing nor widen anyone.
    public static void EnsureHolds(ClaimsPrincipal? actor, IEnumerable<string> keys)
    {
        var held = PermissionChecks.RoleKeysForPrincipal(actor);
        var missing = keys.Where(k => !held.Contains(k)).ToList();
        if (missing.Count > 0)
        {
            throw new ForbiddenActionException("You can only give permissions you have yourself.");
        }
    }

    public static async Task<HashSet<string>> KeysOfAsync(WTFDbContext db, UserRole role, CancellationToken cancellationToken)
    {
        if (role.TenantId is null)
        {
            return SystemRolePermissions.Bundles.TryGetValue(role.Name, out var bundle) ? [.. bundle] : [];
        }

        var stored = await db.RolePermissions
            .Where(p => p.RoleId == role.Id)
            .Select(p => p.PermissionKey)
            .ToListAsync(cancellationToken);

        return PermissionRules.Normalize(stored);
    }

    public static async Task<int> NextRoleIdAsync(WTFDbContext db, CancellationToken cancellationToken)
    {
        if (db.Database.IsRelational())
        {
            var ids = await db.Database
                .SqlQuery<int>($"SELECT NEXT VALUE FOR dbo.UserRoleIdSeq AS [Value]")
                .ToListAsync(cancellationToken);
            return ids[0];
        }

        var highest = await db.UserRoles.IgnoreQueryFilters().MaxAsync(r => (int?)r.Id, cancellationToken) ?? 0;
        return Math.Max(highest + 1, FirstCustomRoleId);
    }

    public static Guid CurrentTenant(WTFDbContext db) =>
        db.StampTenantId ?? throw new InvalidOperationException("Roles belong to a shop; sign in to a shop first.");
}
