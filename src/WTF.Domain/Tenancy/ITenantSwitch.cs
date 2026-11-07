namespace WTF.Domain.Tenancy;

public interface ITenantSwitch
{
    // For code that learns the tenant from something other than a token: a public link, a login, a background job.
    void Use(Guid tenantId);
}
