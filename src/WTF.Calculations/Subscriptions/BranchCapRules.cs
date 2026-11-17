namespace WTF.Calculations.Subscriptions;

public static class BranchCapRules
{
    // A null cap means the plan has no limit. A cap of 1 means the shop keeps its Main branch and nothing else.
    public static bool CanAddBranch(int activeBranches, int? maxBranches) => maxBranches is not { } cap || activeBranches < cap;

    // After a downgrade a shop can hold more active branches than the new plan allows. They all keep working; only adding or
    // reopening a branch is refused until the count is back under the cap.
    public static int BranchesOverCap(int activeBranches, int? maxBranches) => maxBranches is { } cap ? Math.Max(0, activeBranches - cap) : 0;
}
