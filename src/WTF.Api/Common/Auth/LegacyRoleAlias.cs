using System.Security.Claims;

namespace WTF.Api.Common.Auth;

public static class LegacyRoleAlias
{
    private const string LegacySuperAdmin = "SuperAdmin";

    public static void Apply(ClaimsPrincipal? principal)
    {
        if (principal?.Identity is not ClaimsIdentity identity)
        {
            return;
        }

        var roleClaimType = identity.RoleClaimType;
        var hasLegacy = identity.HasClaim(roleClaimType, LegacySuperAdmin);
        if (hasLegacy && !identity.HasClaim(roleClaimType, AppRoles.Owner))
        {
            identity.AddClaim(new Claim(roleClaimType, AppRoles.Owner));
        }
    }
}
