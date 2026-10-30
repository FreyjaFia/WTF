namespace WTF.Calculations.Inventory;

public record RecipeLine(decimal EffectiveQuantity, decimal? UnitCost);

public record RecipeCostSummary(decimal TotalCost, int UnknownCostCount);

public static class CostRules
{
    public const int CostDecimals = 6;

    public static decimal Round(decimal cost) => Math.Round(cost, CostDecimals, MidpointRounding.AwayFromZero);

    // The moving weighted average: the value on hand plus the value received, over the quantity on hand plus the
    // quantity received. A balance that is empty or below zero holds no value, so the new cost starts from the delivery.
    public static decimal WeightedAverage(decimal quantityOnHand, decimal? averageCost, decimal quantityReceived, decimal receivedCost)
    {
        var held = Math.Max(0m, quantityOnHand);
        if (!averageCost.HasValue || held == 0m || quantityReceived <= 0m)
        {
            return Round(receivedCost);
        }

        var total = held + quantityReceived;
        return Round((held * averageCost.Value + quantityReceived * receivedCost) / total);
    }

    // What one usable unit costs when only part of what is bought can be used (a fruit that is 80% usable after peeling).
    public static decimal? UsableCost(decimal? cost, decimal yieldPercent)
    {
        if (!cost.HasValue)
        {
            return null;
        }

        if (yieldPercent <= 0m || yieldPercent >= 100m)
        {
            return Round(cost.Value);
        }

        return Round(cost.Value / (yieldPercent / 100m));
    }

    // What one sale really uses: the standard amount plus the known, steady loss (the spill that always happens).
    public static decimal EffectiveQuantity(decimal quantityPerSale, decimal allowancePercent) =>
        Math.Round(quantityPerSale * (1m + Math.Max(0m, allowancePercent) / 100m), 3, MidpointRounding.AwayFromZero);

    public static decimal LineCost(decimal effectiveQuantity, decimal unitCost) => Round(effectiveQuantity * unitCost);

    // A line with no cost yet is counted as unknown instead of free, so a recipe never looks cheaper than it is.
    public static RecipeCostSummary RecipeCost(IEnumerable<RecipeLine> lines, decimal suppliesCost = 0m)
    {
        var total = Math.Max(0m, suppliesCost);
        var unknown = 0;
        foreach (var line in lines)
        {
            if (line.UnitCost.HasValue)
            {
                total += LineCost(line.EffectiveQuantity, line.UnitCost.Value);
            }
            else
            {
                unknown++;
            }
        }

        return new RecipeCostSummary(Round(total), unknown);
    }

    public static decimal Margin(decimal price, decimal cost) => Round(price - cost);

    // Margin as a share of the price; null when the price is zero, where the share means nothing.
    public static decimal? MarginPercent(decimal price, decimal cost) =>
        price > 0m ? Math.Round((price - cost) / price * 100m, 2, MidpointRounding.AwayFromZero) : null;

    // The cost a movement is recorded at: the average when there is one, otherwise the last cost entered.
    public static decimal? MovementCost(decimal? averageCost, decimal? costPrice) => averageCost ?? costPrice;
}
