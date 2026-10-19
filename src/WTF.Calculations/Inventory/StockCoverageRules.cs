namespace WTF.Calculations.Inventory;

public enum StockCoverage
{
    Covered = 0,
    Partial = 1,
    Missing = 2
}

public record CoverageOption(string Name, bool HasStockLink);

public record CoverageGroup(string TypeName, IReadOnlyList<CoverageOption> Options);

public record CoverageResult(StockCoverage Coverage, IReadOnlyList<string> MissingOptions);

public static class StockCoverageRules
{
    // A sale of the product takes stock when the product itself is linked, or when every option of a required add-on group
    // (Size, Flavor) is. It is only partly covered when a group has some options linked and others not: the unlinked
    // ones would sell without taking anything. A product with no link anywhere takes no stock at all.
    public static CoverageResult Evaluate(bool productHasStockLink, IReadOnlyList<CoverageGroup> requiredGroups)
    {
        var missing = new List<string>();
        var groupFullyLinked = false;

        foreach (var group in requiredGroups.Where(g => g.Options.Count > 0))
        {
            var linked = group.Options.Count(option => option.HasStockLink);
            if (linked == group.Options.Count)
            {
                groupFullyLinked = true;
            }
            else if (linked > 0)
            {
                missing.AddRange(group.Options
                    .Where(option => !option.HasStockLink)
                    .Select(option => $"{group.TypeName}: {option.Name}"));
            }
        }

        if (missing.Count > 0)
        {
            return new CoverageResult(StockCoverage.Partial, missing);
        }

        return productHasStockLink || groupFullyLinked
            ? new CoverageResult(StockCoverage.Covered, [])
            : new CoverageResult(StockCoverage.Missing, []);
    }
}
