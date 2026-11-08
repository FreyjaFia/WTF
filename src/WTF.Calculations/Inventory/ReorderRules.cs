namespace WTF.Calculations.Inventory;

public record ReorderSuggestion(decimal Needed, decimal? Packs, decimal Units);

public static class ReorderRules
{
    // An item is on the reorder list when what is on the shelf plus what is already on its way is still under par.
    public static bool IsBelowPar(decimal? parLevel, decimal onHand, decimal onOrder) =>
        parLevel.HasValue && onHand + onOrder < parLevel.Value;

    // How much to order to get back up to par: par - on hand - on order, rounded up to whole packs when the supplier's
    // pack size is known. A balance below zero counts as empty, so a negative balance never inflates the order.
    public static ReorderSuggestion? Suggest(decimal? parLevel, decimal onHand, decimal onOrder, decimal? unitsPerPack)
    {
        if (!parLevel.HasValue)
        {
            return null;
        }

        var needed = Math.Round(parLevel.Value - Math.Max(0m, onHand) - Math.Max(0m, onOrder), 3, MidpointRounding.AwayFromZero);
        if (needed <= 0m)
        {
            return null;
        }

        if (unitsPerPack is not > 0m)
        {
            return new ReorderSuggestion(needed, null, Math.Ceiling(needed));
        }

        var packs = Math.Ceiling(needed / unitsPerPack.Value);
        return new ReorderSuggestion(needed, packs, PurchasingRules.UnitsFromPacks(packs, unitsPerPack.Value));
    }

    // Units used per day over a period, from the net units sold (sales minus voided sales).
    public static decimal AverageDailyUsage(decimal netUnitsUsed, int days) =>
        days <= 0 ? 0m : Math.Round(Math.Max(0m, netUnitsUsed) / days, 3, MidpointRounding.AwayFromZero);

    // How many days the shelf lasts at the recent pace. Unknown when nothing has been used lately.
    public static decimal? DaysOfCover(decimal onHand, decimal averageDailyUsage) =>
        averageDailyUsage <= 0m ? null : Math.Round(Math.Max(0m, onHand) / averageDailyUsage, 1, MidpointRounding.AwayFromZero);
}
