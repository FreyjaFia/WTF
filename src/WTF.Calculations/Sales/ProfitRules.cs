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
}
