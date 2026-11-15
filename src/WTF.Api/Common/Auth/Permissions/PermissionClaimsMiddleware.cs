using System.Security.Claims;
using WTF.Api.Common.Tenancy;
using WTF.Calculations.Subscriptions;
using WTF.Domain.Data;

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
                var readOnlySignIn = user.FindFirst(ImpersonationClaims.By) is not null
                    && user.FindFirst(ImpersonationClaims.ReadOnly)?.Value != "0";
                IEnumerable<string> roleKeys = readOnlySignIn ? PermissionRules.KeepReadKeys(access.Keys) : access.Keys;

                foreach (var key in roleKeys)
                {
                    identity.AddClaim(new Claim(RoleKeyClaim, key));
                }

                foreach (var key in roleKeys.Where(k => planFeatures is null || PlanFeatures.IsAllowed(PermissionCatalog.FeatureOf(k), planFeatures)))
                {
                    identity.AddClaim(new Claim(PermissionClaim, key));
                }
            }
        }

        await next(context);
    }

    // The shop is resolved the way the data layer resolves it (a token from before tenants belongs to the first shop), so a
    // legacy token is gated by that shop's plan. When shops are filtered but this user has none, only the core features
    // apply. A database that does not filter by shop (unit tests) has no plan to read.
    private static async Task<IReadOnlySet<string>?> LoadPlanFeaturesAsync(HttpContext context, WTFDbContext db, ITenantFeatures tenantFeatures, ClaimsIdentity identity)
    {
        var shopId = db.StampTenantId;
        if (shopId is null && !db.TenantFilterEnabled)
        {
            return null;
        }

        var plan = shopId is { } id
            ? await tenantFeatures.GetAsync(db, id, context.RequestAborted)
            : new TenantPlan(string.Empty, PlanFeatures.Parse(null));

        identity.AddClaim(new Claim(PlanLoadedClaim, plan.Name));
        foreach (var feature in plan.Features)
        {
            identity.AddClaim(new Claim(PlanFeatureClaim, feature));
        }

        return plan.Features;
    }
}
