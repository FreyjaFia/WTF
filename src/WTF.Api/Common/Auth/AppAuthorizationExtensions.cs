using Microsoft.AspNetCore.Authorization;
using WTF.Api.Common.Auth.Permissions;

namespace WTF.Api.Common.Auth;

public static class AppAuthorizationExtensions
{
    public static AuthorizationBuilder AddAppAuthorization(this IServiceCollection services)
    {
        services.AddSingleton<IAuthorizationHandler, PermissionAuthorizationHandler>();

        var builder = services.AddAuthorizationBuilder()
            .AddPolicy(AppPolicies.PlatformAdmin, policy =>
                policy.RequireRole(AppRoles.PlatformAdmin));

        foreach (var (policyName, permissions) in PermissionCatalog.PolicyPermissions)
        {
            builder.AddPolicy(policyName, policy =>
                policy.Requirements.Add(new PermissionRequirement(permissions)));
        }

        return builder;
    }
}
