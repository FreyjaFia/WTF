using System.Security.Claims;
using WTF.Api.Common.Auth;
using WTF.Domain.Tenancy;

namespace WTF.Api.Common.Tenancy;

// Every shop token names its shop. Only platform admin tokens live outside shops; any other token without a shop is refused.
public static class TenantTokenRule
{
    public static bool IsAccepted(ClaimsPrincipal user)
    {
        return user.IsInRole(AppRoles.PlatformAdmin) || Guid.TryParse(user.FindFirst(TenantDefaults.ClaimType)?.Value, out var id) && id != Guid.Empty;
    }
}
