using System.Security.Claims;

namespace WTF.Api.Common.Auth.Permissions;

public static class PermissionChecks
{
    public static HashSet<string> ForPrincipal(ClaimsPrincipal? user)
    {
        var keys = new HashSet<string>();
        if (user is null)
        {
            return keys;
        }

        if (user.HasClaim(c => c.Type == PermissionClaimsMiddleware.ResolvedClaim))
        {
            keys.UnionWith(user.FindAll(PermissionClaimsMiddleware.PermissionClaim).Select(c => c.Value));
            return keys;
        }

        foreach (var role in user.FindAll(ClaimTypes.Role))
        {
            if (SystemRolePermissions.Bundles.TryGetValue(role.Value, out var bundle))
            {
                keys.UnionWith(bundle);
            }
        }

        return keys;
    }

    public static HashSet<string> RoleKeysForPrincipal(ClaimsPrincipal? user)
    {
        if (user is not null && user.HasClaim(c => c.Type == PermissionClaimsMiddleware.ResolvedClaim))
        {
            return [.. user.FindAll(PermissionClaimsMiddleware.RoleKeyClaim).Select(c => c.Value)];
        }

        return ForPrincipal(user);
    }

    public static bool Has(ClaimsPrincipal? user, string permission) => ForPrincipal(user).Contains(permission);

    public static bool HasAny(ClaimsPrincipal? user, IEnumerable<string> permissions)
    {
        var held = ForPrincipal(user);
        return permissions.Any(held.Contains);
    }
}
