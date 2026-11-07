namespace WTF.Domain.Tenancy;

public interface ICurrentTenant
{
    // False: no tenant filtering at all (Tenancy:Mode = Single, and code that has no tenant concept).
    // True: a query only sees rows of TenantId; when TenantId is null it sees nothing (fail closed).
    bool FilterEnabled { get; }

    Guid? TenantId { get; }

    // The tenant written on new rows. In Single mode this is the default tenant even though nothing is filtered.
    Guid? StampTenantId { get; }
}
