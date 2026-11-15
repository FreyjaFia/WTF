using WTF.Domain.Tenancy;

namespace WTF.Api.Common.Tenancy;

public sealed class CurrentTenant(IHttpContextAccessor httpContextAccessor) : ICurrentTenant, ITenantSwitch
{
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

        var value = httpContextAccessor.HttpContext?.User.FindFirst(TenantDefaults.ClaimType)?.Value;

        return Guid.TryParse(value, out var tenantId) ? tenantId : null;
    }
}
