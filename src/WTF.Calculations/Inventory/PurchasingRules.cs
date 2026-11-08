namespace WTF.Calculations.Inventory;

public static class PurchasingRules
{
    // What one unit of the item costs when it is bought in packs (a carton of 12 bottles at 840 costs 70 a bottle).
    public static decimal? UnitCost(decimal? packPrice, decimal unitsPerPack)
    {
        if (!packPrice.HasValue || unitsPerPack <= 0m)
        {
            return null;
        }

        return CostRules.Round(packPrice.Value / unitsPerPack);
    }

    // How many item units a number of packs adds to the shelf.
    public static decimal UnitsFromPacks(decimal packs, decimal unitsPerPack) =>
        Math.Round(packs * unitsPerPack, 3, MidpointRounding.AwayFromZero);

    // The change of a price as a percentage of the old one; null when there is no old price to compare with.
    public static decimal? PriceChangePercent(decimal? oldPrice, decimal newPrice)
    {
        if (!oldPrice.HasValue || oldPrice.Value <= 0m)
        {
            return null;
        }

        return Math.Round((newPrice - oldPrice.Value) / oldPrice.Value * 100m, 1, MidpointRounding.AwayFromZero);
    }

    // The cheapest supplier per unit; suppliers with no price yet cannot win.
    public static int? CheapestIndex(IReadOnlyList<decimal?> unitCosts)
    {
        int? best = null;
        for (var i = 0; i < unitCosts.Count; i++)
        {
            if (unitCosts[i] is null)
            {
                continue;
            }

            if (best is null || unitCosts[i] < unitCosts[best.Value])
            {
                best = i;
            }
        }

        return best;
    }

    // What a received line cost: packs times the pack price, to the centavo. Unknown while no price was typed.
    public static decimal? LineTotal(decimal packs, decimal? packPrice) =>
        packPrice.HasValue ? Math.Round(packs * packPrice.Value, 2, MidpointRounding.AwayFromZero) : null;

    // The invoice total minus what the lines add up to. Zero means the receipt matches the paper; null means there
    // is nothing to compare (no total typed, or a line without a price).
    public static decimal? InvoiceDifference(decimal? invoiceTotal, IEnumerable<decimal?> lineTotals)
    {
        if (!invoiceTotal.HasValue)
        {
            return null;
        }

        var totals = lineTotals.ToList();
        if (totals.Any(total => total is null))
        {
            return null;
        }

        return Math.Round(invoiceTotal.Value - totals.Sum(total => total!.Value), 2, MidpointRounding.AwayFromZero);
    }
}
