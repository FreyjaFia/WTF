namespace WTF.Domain.Tenancy;

public interface ICurrentTenant
{
    // True: a query only sees rows of TenantId; when TenantId is null it sees nothing (fail closed).
    // False only for code that has no tenant concept (NoTenant: design-time and the platform area).
    bool FilterEnabled { get; }

    Guid? TenantId { get; }

    // The tenant written on new rows.
    Guid? StampTenantId { get; }
}
