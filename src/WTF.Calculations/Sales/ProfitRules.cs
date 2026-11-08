namespace WTF.Calculations.Sales;

public enum CostCoverage
{
    Known = 0,
    Partly = 1,
    Unknown = 2
}

public static class ProfitRules
{
    // Splits what one product cost in one order between the lines that carried it (a drink sold on its own and inside a
    // bundle), in proportion to the units on each line. The last share takes the rounding, so the shares add up to the total.
    public static List<decimal> AllocateByUnits(decimal totalCost, IReadOnlyList<decimal> units)
    {
        var shares = new List<decimal>(units.Count);
        var totalUnits = units.Sum();
        if (units.Count == 0)
        {
            return shares;
        }

        if (totalUnits <= 0m)
        {
            shares.AddRange(units.Select(_ => 0m));
            return shares;
        }

        var given = 0m;
        for (var i = 0; i < units.Count; i++)
        {
            var share = i == units.Count - 1
                ? Math.Round(totalCost - given, 6, MidpointRounding.AwayFromZero)
                : Math.Round(totalCost * units[i] / totalUnits, 6, MidpointRounding.AwayFromZero);
            shares.Add(share);
            given += share;
        }

        return shares;
    }

    // Whether the cost of a row can be trusted: every unit sold has a cost (Known), some have (Partly) or none has (Unknown).
    // A row with nothing sold has no unit to be unsure about, so its cost is known.
    public static CostCoverage Coverage(decimal costedUnits, decimal uncostedUnits)
    {
        if (uncostedUnits <= 0m)
        {
            return CostCoverage.Known;
        }

        return costedUnits > 0m ? CostCoverage.Partly : CostCoverage.Unknown;
    }

    public static decimal? MarginPercent(decimal revenue, decimal profit) =>
        revenue > 0m ? Math.Round(profit / revenue * 100m, 2, MidpointRounding.AwayFromZero) : null;

    // What a stock movement cost the shop. Stock leaving (a negative quantity) is a cost; stock coming back (a refund, a
    // reversed waste entry) gives it back.
    public static decimal MovementCost(decimal quantityDelta, decimal unitCost) => -quantityDelta * unitCost;

    // Theoretical profit is what the sales and the recipes say; actual profit also takes off the waste and the corrections
    // found on counts, because that stock was paid for and never sold.
    public static GrossProfitSummary GrossProfit(decimal netSales, decimal cost, decimal waste, decimal countVariance)
    {
        var theoretical = Math.Round(netSales - cost, 2, MidpointRounding.AwayFromZero);
        var actual = Math.Round(theoretical - waste - countVariance, 2, MidpointRounding.AwayFromZero);
        return new GrossProfitSummary(theoretical, actual, MarginPercent(netSales, actual));
    }

    // A period with some units sold at an unknown cost, or a waste or count entry with no cost, is only partly known. A
    // period where nothing sold has a known cost.
    // Waste as a share of everything the shop used: what the sales used (cost) plus what was thrown away. Null when nothing was used.
    public static decimal? WastePercent(decimal salesCost, decimal wasteCost)
    {
        var used = salesCost + wasteCost;
        return used > 0m ? Math.Round(wasteCost / used * 100m, 2, MidpointRounding.AwayFromZero) : null;
    }

    // One status for several periods: Known only when every period is, No cost only when none has a cost.
    public static string CombineCostStatus(IEnumerable<string> statuses)
    {
        var list = statuses.ToList();
        if (list.Count == 0 || list.All(s => s == "Known"))
        {
            return "Known";
        }

        return list.All(s => s == "No cost") ? "No cost" : "Partly known";
    }

    // What is left of the actual gross profit after the shop's running costs (rent, salaries and so on). Null when the gross
    // profit itself is not known, because an estimate built on a missing cost would overstate it.
    public static OperatingSummary OperatingProfit(decimal netSales, decimal? actualProfit, decimal expenses)
    {
        var rounded = Math.Round(expenses, 2, MidpointRounding.AwayFromZero);
        if (actualProfit is null)
        {
            return new OperatingSummary(rounded, null, null);
        }

        var operating = Math.Round(actualProfit.Value - rounded, 2, MidpointRounding.AwayFromZero);
        return new OperatingSummary(rounded, operating, MarginPercent(netSales, operating));
    }

    public static string CostStatus(CostCoverage coverage, bool hasUnpricedLoss) => coverage switch
    {
        CostCoverage.Unknown => "No cost",
        CostCoverage.Partly => "Partly known",
        _ => hasUnpricedLoss ? "Partly known" : "Known"
    };
}

public record GrossProfitSummary(decimal TheoreticalProfit, decimal ActualProfit, decimal? MarginPercent);

public record OperatingSummary(decimal Expenses, decimal? OperatingProfit, decimal? MarginPercent);
