using Microsoft.Extensions.Options;
using WTF.Api.Common.Auth;
using WTF.Domain.Tenancy;

namespace WTF.Api.Common.Tenancy;

public sealed class CurrentTenant(IOptions<TenancyOptions> options, IHttpContextAccessor httpContextAccessor)
    : ICurrentTenant, ITenantSwitch
{
    private readonly bool _legacyTokensAreDefaultTenant = options.Value.LegacyTokensAreDefaultTenant;

    private Guid? _override;

    public bool FilterEnabled => true;

    public Guid? TenantId => Resolve();

    public Guid? StampTenantId => Resolve();

    // A tenant chosen by the code (a link's tenant, a job's tenant) wins over the token, but only once, in this scope.
    public void Use(Guid tenantId) => _override = tenantId;

    private Guid? Resolve()
    {
        if (_override is not null)
        {
            return _override;
        }

        var user = httpContextAccessor.HttpContext?.User;
        var value = user?.FindFirst(TenantDefaults.ClaimType)?.Value;
        if (Guid.TryParse(value, out var tenantId))
        {
            return tenantId;
        }

        // Tokens issued before tenants existed have no claim: for one release they belong to the first tenant.
        if (_legacyTokensAreDefaultTenant && user?.Identity?.IsAuthenticated == true && string.IsNullOrEmpty(value)
            && !user.IsInRole(AppRoles.PlatformAdmin))
        {
            return TenantDefaults.DefaultTenantId;
        }

        return null;
    }
}
