using System.Security.Claims;
using WTF.Api.Common.Tenancy;
using WTF.Calculations.Subscriptions;
using WTF.Domain.Data;
using WTF.Domain.Tenancy;

namespace WTF.Api.Common.Auth.Permissions;

// Looks up the signed-in user's current role on every request (cached for a few seconds) and puts its permissions on the
// request, so a role change takes effect on the next action. A token naming a role that no longer exists (for example
// SuperAdmin before the rename) gets no permissions at all.
public sealed class PermissionClaimsMiddleware(RequestDelegate next)
{
    public const string ResolvedClaim = "perm_resolved";
    public const string PermissionClaim = "perm";
    public const string RoleKeyClaim = "role_perm";
    public const string PlanFeatureClaim = "plan_feature";
    public const string PlanLoadedClaim = "plan_loaded";

    public async Task InvokeAsync(HttpContext context, RolePermissionCache cache, ITenantFeatures tenantFeatures)
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
            var planFeatures = await LoadPlanFeaturesAsync(context, db, tenantFeatures, identity);
            if (access.IsActive && tokenIsCurrent)
            {
                foreach (var key in access.Keys)
                {
                    identity.AddClaim(new Claim(RoleKeyClaim, key));
                }

                foreach (var key in access.Keys.Where(k => planFeatures is null || PlanFeatures.IsAllowed(PermissionCatalog.FeatureOf(k), planFeatures)))
                {
                    identity.AddClaim(new Claim(PermissionClaim, key));
                }
            }
        }

        await next(context);
    }

    private static async Task<IReadOnlySet<string>?> LoadPlanFeaturesAsync(HttpContext context, WTFDbContext db, ITenantFeatures tenantFeatures, ClaimsIdentity identity)
    {
        if (!Guid.TryParse(identity.FindFirst(TenantDefaults.ClaimType)?.Value, out var tenantId))
        {
            return null;
        }

        var plan = await tenantFeatures.GetAsync(db, tenantId, context.RequestAborted);
        identity.AddClaim(new Claim(PlanLoadedClaim, plan.Name));
        foreach (var feature in plan.Features)
        {
            identity.AddClaim(new Claim(PlanFeatureClaim, feature));
        }

        return plan.Features;
    }
}
