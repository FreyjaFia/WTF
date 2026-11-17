using WTF.Domain.Tenancy;

namespace WTF.Api.Common.Tenancy;

public sealed class CurrentBranch : ICurrentBranch, IBranchSwitch
{
    private static readonly IReadOnlyCollection<Guid> None = [];

    public bool FilterEnabled { get; private set; }

    public IReadOnlyCollection<Guid> VisibleBranchIds { get; private set; } = None;

    public bool WriteCheckEnabled { get; private set; }

    public IReadOnlyCollection<Guid> AllowedBranchIds { get; private set; } = None;

    public Guid? ActiveBranchId { get; private set; }

    public bool IsAllBranches { get; private set; }

    public void Resolve(IReadOnlyCollection<Guid> allowed, bool limitedScope, Guid? active, bool allBranches)
    {
        FilterEnabled = true;
        AllowedBranchIds = allowed;
        WriteCheckEnabled = limitedScope;
        ActiveBranchId = active;
        IsAllBranches = allBranches;
        VisibleBranchIds = allBranches || active is null ? allowed : [active.Value];
    }

    // A public link or a job that works in one named branch. The filter stays off; new rows are written there.
    public void Use(Guid branchId)
    {
        ActiveBranchId = branchId;
    }
}
