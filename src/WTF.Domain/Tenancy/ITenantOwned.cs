namespace WTF.Domain.Tenancy;

public interface ITenantOwned
{
    Guid TenantId { get; set; }
}
