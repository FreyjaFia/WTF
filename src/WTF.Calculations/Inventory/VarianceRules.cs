namespace WTF.Calculations.Inventory;

public record VarianceMovement(string MovementType, decimal QuantityDelta, decimal? UnitCost);

public record VarianceSummary(
    decimal Received,
    decimal TheoreticalUsage,
    decimal Waste,
    decimal Corrections,
    decimal ActualUsage,
    decimal Variance,
    decimal? VariancePercent,
    decimal? VarianceValue,
    bool WasCounted);

public static class VarianceRules
{
    public const string AddStock = "AddStock";
    public const string Sale = "Sale";
    public const string SaleVoid = "SaleVoid";
    public const string Waste = "Waste";
    public const string WasteReversed = "WasteReversed";
    public const string Adjustment = "Adjustment";
    public const string Count = "Count";

    public static VarianceSummary Summarize(IEnumerable<VarianceMovement> movements)
    {
        var list = movements.ToList();

        var received = list.Where(m => m.MovementType == AddStock).Sum(m => m.QuantityDelta);
        var theoretical = -list.Where(m => m.MovementType is Sale or SaleVoid).Sum(m => m.QuantityDelta);
        var waste = -list.Where(m => m.MovementType is Waste or WasteReversed).Sum(m => m.QuantityDelta);
        var corrections = list.Where(m => m.MovementType is Count or Adjustment).ToList();
        var correction = corrections.Sum(m => m.QuantityDelta);

        // Actual usage is opening + received - closing, which equals every quantity that left the shelf.
        var actual = theoretical + waste - correction;
        var variance = actual - theoretical - waste;

        var costed = corrections.Where(m => m.UnitCost.HasValue).ToList();
        var value = costed.Count == corrections.Count && corrections.Count > 0
            ? StockRules.Round(-costed.Sum(m => m.QuantityDelta * m.UnitCost!.Value))
            : (decimal?)null;

        return new VarianceSummary(
            StockRules.Round(received),
            StockRules.Round(theoretical),
            StockRules.Round(waste),
            StockRules.Round(correction),
            StockRules.Round(actual),
            StockRules.Round(variance),
            PercentOfTheoretical(variance, theoretical),
            value,
            list.Any(m => m.MovementType == Count));
    }

    public static decimal? PercentOfTheoretical(decimal variance, decimal theoretical) =>
        theoretical > 0 ? Math.Round(variance / theoretical * 100m, 1, MidpointRounding.AwayFromZero) : null;

    public static string Status(VarianceSummary summary, decimal tolerancePercent)
    {
        if (!summary.WasCounted)
        {
            return "Not counted";
        }

        if (summary.Variance == 0m)
        {
            return "OK";
        }

        if (summary.VariancePercent is null)
        {
            return "Check";
        }

        return Math.Abs(summary.VariancePercent.Value) > tolerancePercent ? "Check" : "OK";
    }
}
