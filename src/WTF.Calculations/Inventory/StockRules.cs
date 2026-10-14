namespace WTF.Calculations.Inventory;

public enum StockStatus
{
    Ok = 0,
    Warning = 1,
    Critical = 2,
    OutOfStock = 3
}

public static class StockRules
{
    public static StockStatus StatusFor(decimal quantity, decimal? warningQuantity, decimal? criticalQuantity)
    {
        if (quantity <= 0m)
        {
            return StockStatus.OutOfStock;
        }

        if (criticalQuantity.HasValue && quantity <= criticalQuantity.Value)
        {
            return StockStatus.Critical;
        }

        if (warningQuantity.HasValue && quantity <= warningQuantity.Value)
        {
            return StockStatus.Warning;
        }

        return StockStatus.Ok;
    }

    public static decimal StockValue(decimal quantity, decimal? costPrice) =>
        costPrice.HasValue ? Math.Max(0m, quantity) * costPrice.Value : 0m;
}
