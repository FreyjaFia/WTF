namespace WTF.Domain.Tenancy;

public interface ICurrentBranch
{
    // True: a query only sees rows of VisibleBranchIds (the branch the person works in, or all they may see).
    // False for everything that is not a signed-in user with a resolved branch (public links, background jobs, design time).
    bool FilterEnabled { get; }

    IReadOnlyCollection<Guid> VisibleBranchIds { get; }

    // True for a user limited to selected branches: a row can only be written in AllowedBranchIds.
    bool WriteCheckEnabled { get; }

    IReadOnlyCollection<Guid> AllowedBranchIds { get; }

    // The branch new rows are written to. Null means "the shop's Main branch".
    Guid? ActiveBranchId { get; }
}

public interface IBranchSwitch
{
    void Use(Guid branchId);
}
