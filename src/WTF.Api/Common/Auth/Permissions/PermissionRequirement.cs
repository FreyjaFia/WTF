using Microsoft.AspNetCore.Authorization;

namespace WTF.Api.Common.Auth.Permissions;

public class PermissionRequirement(IReadOnlyList<string> anyOf) : IAuthorizationRequirement
{
    public IReadOnlyList<string> AnyOf { get; } = anyOf;
}

public class PermissionAuthorizationHandler : AuthorizationHandler<PermissionRequirement>
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext context, PermissionRequirement requirement)
    {
        if (PermissionChecks.HasAny(context.User, requirement.AnyOf))
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }
}
