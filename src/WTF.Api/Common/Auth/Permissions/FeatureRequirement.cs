using Microsoft.AspNetCore.Authorization;
using System.Security.Claims;

namespace WTF.Api.Common.Auth.Permissions;

public class FeatureRequirement(string feature) : IAuthorizationRequirement
{
    public string Feature { get; } = feature;
}

// Answers the same 403 not_in_plan as a permission outside the plan.
public class FeatureAuthorizationHandler : AuthorizationHandler<FeatureRequirement>
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext context, FeatureRequirement requirement)
    {
        if (!IsInPlan(context.User, requirement.Feature))
        {
            context.Fail(new AuthorizationFailureReason(this, PermissionAuthorizationHandler.NotInPlanMessage));
            return Task.CompletedTask;
        }

        context.Succeed(requirement);
        return Task.CompletedTask;
    }

    public static bool IsInPlan(ClaimsPrincipal user, string feature)
    {
        // PermissionClaimsMiddleware adds the plan claim to every signed-in shop user. Without it the request never went through
        // the middleware (platform area, unit tests), and nothing here may block it.
        if (!user.HasClaim(c => c.Type == PermissionClaimsMiddleware.PlanLoadedClaim))
        {
            return true;
        }

        return user.FindAll(PermissionClaimsMiddleware.PlanFeatureClaim)
            .Any(c => string.Equals(c.Value, feature, StringComparison.OrdinalIgnoreCase));
    }
}
