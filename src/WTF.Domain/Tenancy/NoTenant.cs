namespace WTF.Domain.Tenancy;

public sealed class NoTenant : ICurrentTenant
{
    public static readonly NoTenant Instance = new();

    public bool FilterEnabled => false;

    public Guid? TenantId => null;

    public Guid? StampTenantId => null;
}
