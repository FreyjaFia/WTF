namespace WTF.Calculations.Catalog;

// "Sold at": a product with no branch rows is sold at every branch (also at branches opened later). A product with rows is
// sold only at those branches. A branch-only product is the case of one branch.
public static class ProductAvailability
{
    public static bool IsSoldAt(IReadOnlyCollection<Guid> soldAtBranchIds, Guid branchId)
    {
        return soldAtBranchIds.Count == 0 || soldAtBranchIds.Contains(branchId);
    }

    public static bool IsBranchOnly(IReadOnlyCollection<Guid> soldAtBranchIds)
    {
        return soldAtBranchIds.Count == 1;
    }

    // A person limited to some branches may change a product only when it is already limited and every branch it is sold at is
    // one of theirs. A product sold everywhere, or partly at branches they do not work in, stays with the shop-wide editors.
    public static bool MayBranchEdit(IReadOnlyCollection<Guid> soldAtBranchIds, IReadOnlyCollection<Guid> allowedBranchIds)
    {
        return soldAtBranchIds.Count > 0 && soldAtBranchIds.All(allowedBranchIds.Contains);
    }
}
