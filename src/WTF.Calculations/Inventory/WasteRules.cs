namespace WTF.Calculations.Inventory;

public record WasteEntry(decimal Quantity, string? UnitName, bool IsDisputed);

public record WasteSummary(int EntryCount, decimal Quantity, int DisputedCount, decimal DisputedQuantity);

public static class WasteRules
{
    public static bool NeedsReview(decimal quantity, decimal? approvalLimit) =>
        approvalLimit.HasValue && StockRules.Round(quantity) > StockRules.Round(approvalLimit.Value);

    public static decimal BalanceAfter(decimal balance, decimal quantity) =>
        StockRules.Round(balance - quantity);

    public static decimal Shortfall(decimal balance, decimal quantity) =>
        StockRules.Shortfall(balance, quantity);

    public static string NormalizeUnit(string? unitName) => unitName?.Trim() ?? string.Empty;

    public static bool SameUnit(string? left, string? right) =>
        string.Equals(NormalizeUnit(left), NormalizeUnit(right), StringComparison.OrdinalIgnoreCase);

    public static bool HasSingleUnit(IEnumerable<string?> unitNames) =>
        unitNames.Select(NormalizeUnit).Distinct(StringComparer.OrdinalIgnoreCase).Count() <= 1;

    public static WasteSummary Summarize(IEnumerable<WasteEntry> entries)
    {
        var list = entries.ToList();
        var disputed = list.Where(e => e.IsDisputed).ToList();

        return new WasteSummary(
            list.Count,
            StockRules.Round(list.Sum(e => e.Quantity)),
            disputed.Count,
            StockRules.Round(disputed.Sum(e => e.Quantity)));
    }

    // Quantities in different (or unknown) units cannot be added, so the total is left blank.
    public static decimal? TotalQuantity(IEnumerable<WasteEntry> entries)
    {
        var list = entries.ToList();

        if (list.Any(e => NormalizeUnit(e.UnitName).Length == 0) || !HasSingleUnit(list.Select(e => e.UnitName)))
        {
            return null;
        }

        return StockRules.Round(list.Sum(e => e.Quantity));
    }
}
