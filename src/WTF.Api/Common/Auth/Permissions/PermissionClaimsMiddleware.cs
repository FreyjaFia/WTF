using System.Security.Claims;
using WTF.Domain.Data;

namespace WTF.Api.Common.Auth.Permissions;

// Looks up the signed-in user's current role on every request (cached for a few seconds) and puts its permissions on the
// request, so a role change takes effect on the next action. A token naming a role that no longer exists (for example
// SuperAdmin before the rename) gets no permissions at all.
public sealed class PermissionClaimsMiddleware(RequestDelegate next)
{
    public const string ResolvedClaim = "perm_resolved";
    public const string PermissionClaim = "perm";

    public async Task InvokeAsync(HttpContext context, RolePermissionCache cache)
    {
        var user = context.User;
        if (user.Identity is ClaimsIdentity identity && identity.IsAuthenticated
            && !user.IsInRole(AppRoles.PlatformAdmin)
            && Guid.TryParse(user.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var userId))
        {
            var db = context.RequestServices.GetRequiredService<WTFDbContext>();
            var access = await cache.GetAsync(db, userId, context.RequestAborted);
            var tokenRole = user.FindFirst(ClaimTypes.Role)?.Value;
            var tokenIsCurrent = tokenRole is not null && access.KnownRoleNames.Contains(tokenRole);

            identity.AddClaim(new Claim(ResolvedClaim, "1"));
            if (access.IsActive && tokenIsCurrent)
            {
                foreach (var key in access.Keys)
                {
                    identity.AddClaim(new Claim(PermissionClaim, key));
                }
            }
        }

        await next(context);
    }
}
