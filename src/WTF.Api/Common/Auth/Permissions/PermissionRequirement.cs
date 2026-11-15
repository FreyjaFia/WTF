using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using System.Security.Claims;

namespace WTF.Api.Common.Auth.Permissions;

public class PermissionRequirement(IReadOnlyList<string> anyOf) : IAuthorizationRequirement
{
    public IReadOnlyList<string> AnyOf { get; } = anyOf;
}

public class PermissionAuthorizationHandler : AuthorizationHandler<PermissionRequirement>
{
    public const string NotInPlanMessage = "This feature is not in your plan.";

    protected override Task HandleRequirementAsync(AuthorizationHandlerContext context, PermissionRequirement requirement)
    {
        // The plan decides what exists, so it is answered before the role is asked.
        if (IsOutsidePlan(context.User, requirement.AnyOf))
        {
            context.Fail(new NotInPlanReason(this, PermissionCatalog.FeatureOf(requirement.AnyOf[0])));
            return Task.CompletedTask;
        }

        if (PermissionChecks.HasAny(context.User, requirement.AnyOf))
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }

    public static bool IsOutsidePlan(ClaimsPrincipal user, IEnumerable<string> keys)
    {
        if (!user.HasClaim(c => c.Type == PermissionClaimsMiddleware.PlanLoadedClaim))
        {
            return false;
        }

        var features = user.FindAll(PermissionClaimsMiddleware.PlanFeatureClaim).Select(c => c.Value).ToHashSet(StringComparer.OrdinalIgnoreCase);
        return keys.All(k => !features.Contains(PermissionCatalog.FeatureOf(k)));
    }
}

public sealed class NotInPlanReason(IAuthorizationHandler handler, string feature)
    : AuthorizationFailureReason(handler, PermissionAuthorizationHandler.NotInPlanMessage)
{
    public string Feature { get; } = feature;
}

public sealed class PlanAwareAuthorizationResultHandler : IAuthorizationMiddlewareResultHandler
{
    private readonly AuthorizationMiddlewareResultHandler _default = new();

    public async Task HandleAsync(RequestDelegate next, HttpContext context, AuthorizationPolicy policy, PolicyAuthorizationResult authorizeResult)
    {
        var reason = authorizeResult.Forbidden
            ? authorizeResult.AuthorizationFailure?.FailureReasons.OfType<NotInPlanReason>().FirstOrDefault()
            : null;

        if (reason is not null)
        {
            context.RequestServices?.GetService<ILoggerFactory>()?.CreateLogger<PlanAwareAuthorizationResultHandler>()
                .LogInformation("Refused {Method} {Path}: feature {Feature} is not in the shop plan", context.Request.Method, context.Request.Path, reason.Feature);

            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new { message = PermissionAuthorizationHandler.NotInPlanMessage, code = "not_in_plan", feature = reason.Feature });
            return;
        }

        await _default.HandleAsync(next, context, policy, authorizeResult);
    }
}
