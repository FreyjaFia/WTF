namespace WTF.Domain.Tenancy;

public sealed class NoBranch : ICurrentBranch
{
    public static readonly NoBranch Instance = new();

    public bool FilterEnabled => false;

    public IReadOnlyCollection<Guid> VisibleBranchIds { get; } = [];

    public bool WriteCheckEnabled => false;

    public IReadOnlyCollection<Guid> AllowedBranchIds { get; } = [];

    public Guid? ActiveBranchId => null;
}
