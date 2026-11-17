namespace WTF.Domain.Tenancy;

public interface IBranchOwned
{
    Guid BranchId { get; set; }
}
