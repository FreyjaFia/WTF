using System.Security.Claims;
using WTF.Api.Common.Auth;

namespace WTF.Api.Features.Platform;

public static class PlatformCaller
{
    public static (Guid Id, string Username) Resolve(IHttpContextAccessor accessor)
    {
        var user = accessor.HttpContext?.User;
        var id = user?.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? user?.FindFirst("sub")?.Value;

        if (user is null || !user.IsInRole(AppRoles.PlatformAdmin) || !Guid.TryParse(id, out var adminId))
        {
            throw new InvalidOperationException("Only a platform admin can do this.");
        }

        return (adminId, user.Identity?.Name ?? user.FindFirst("unique_name")?.Value ?? "platform");
    }
}
