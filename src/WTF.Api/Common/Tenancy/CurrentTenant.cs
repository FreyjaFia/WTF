using Microsoft.Extensions.Options;
using WTF.Domain.Tenancy;

namespace WTF.Api.Common.Tenancy;

public sealed class CurrentTenant(IOptions<TenancyOptions> options, IHttpContextAccessor httpContextAccessor) : ICurrentTenant
{
    private readonly bool _isMulti = options.Value.IsMulti;

    public bool FilterEnabled => _isMulti;

    public Guid? TenantId => _isMulti ? ReadTenantFromToken() : null;

    public Guid? StampTenantId => _isMulti ? ReadTenantFromToken() : TenantDefaults.DefaultTenantId;

    private Guid? ReadTenantFromToken()
    {
        var value = httpContextAccessor.HttpContext?.User.FindFirst(TenantDefaults.ClaimType)?.Value;
        return Guid.TryParse(value, out var tenantId) ? tenantId : null;
    }
}
