using Microsoft.AspNetCore.Authorization;
using WTF.Api.Common.Auth.Permissions;
using WTF.Calculations.Subscriptions;

namespace WTF.Api.Common.Auth;

public static class AppAuthorizationExtensions
{
    public static AuthorizationBuilder AddAppAuthorization(this IServiceCollection services)
    {
        services.AddSingleton<IAuthorizationHandler, PermissionAuthorizationHandler>();
        services.AddSingleton<IAuthorizationHandler, FeatureAuthorizationHandler>();

        var builder = services.AddAuthorizationBuilder()
            .AddPolicy(AppPolicies.PlatformAdmin, policy =>
                policy.RequireRole(AppRoles.PlatformAdmin));

        foreach (var (policyName, permissions) in PermissionCatalog.PolicyPermissions)
        {
            builder.AddPolicy(policyName, policy =>
                policy.Requirements.Add(new PermissionRequirement(permissions)));
        }

        foreach (var feature in PlanFeatures.Gateable)
        {
            builder.AddPolicy(AppPolicies.RequireFeature(feature), policy =>
                policy.Requirements.Add(new FeatureRequirement(feature)));
        }

        return builder;
    }
}
