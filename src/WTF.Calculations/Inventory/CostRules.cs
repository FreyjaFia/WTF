namespace WTF.Calculations.Inventory;

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

    // The cost a movement is recorded at: the average when there is one, otherwise the last cost entered.
    public static decimal? MovementCost(decimal? averageCost, decimal? costPrice) => averageCost ?? costPrice;
}
