namespace WTF.Domain.Tenancy;

public static class TenantDefaults
{
    public const string ClaimType = "tenant_id";

    public static readonly Guid DefaultTenantId = new("00000000-0000-0000-0000-000000000001");

    public const string DefaultTenantSlug = "wtf";
}
