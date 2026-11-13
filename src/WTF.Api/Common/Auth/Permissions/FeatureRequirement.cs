using Microsoft.AspNetCore.Authorization;
using System.Security.Claims;

namespace WTF.Api.Common.Auth.Permissions;

public class FeatureRequirement(string feature) : IAuthorizationRequirement
{
    public string Feature { get; } = feature;
}

// For routes whose permission is core but whose data belongs to a switchable feature (for example the stock reports).
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
        if (!user.HasClaim(c => c.Type == PermissionClaimsMiddleware.PlanLoadedClaim))
        {
            return true;
        }

        return user.FindAll(PermissionClaimsMiddleware.PlanFeatureClaim)
            .Any(c => string.Equals(c.Value, feature, StringComparison.OrdinalIgnoreCase));
    }
}
