namespace WTF.Calculations.Sales;

public record MenuItemSales(Guid Key, decimal Quantity, decimal Profit);

public record MenuItemRating(Guid Key, decimal PopularityPercent, decimal UnitProfit, string MenuClass);

// Menu engineering sorts the items that were sold into four groups by how popular they are and how much each sale earns.
// Popular means a share of the units sold of at least 70% of an even share (the usual rule of thumb: with ten items an even
// share is 10%, so 7% or more is popular). High margin means a profit per unit at or above the average profit per unit over
// everything sold (total profit over total units, so a best seller weighs more than a rarity).
public static class MenuEngineeringRules
{
    public const decimal PopularityFactor = 0.7m;

    public const string Star = "Star";
    public const string Plowhorse = "Plowhorse";
    public const string Puzzle = "Puzzle";
    public const string Dog = "Dog";

    public static List<MenuItemRating> Rate(IReadOnlyList<MenuItemSales> items)
    {
        var sold = items.Where(item => item.Quantity > 0m).ToList();
        if (sold.Count == 0)
        {
            return [];
        }

        var totalUnits = sold.Sum(item => item.Quantity);
        var averageUnitProfit = sold.Sum(item => item.Profit) / totalUnits;
        var popularityThreshold = PopularityFactor / sold.Count;

        return [.. sold.Select(item =>
        {
            var share = item.Quantity / totalUnits;
            var unitProfit = item.Profit / item.Quantity;
            var popular = share >= popularityThreshold;
            var highMargin = unitProfit >= averageUnitProfit;

            return new MenuItemRating(
                item.Key,
                Math.Round(share * 100m, 2, MidpointRounding.AwayFromZero),
                Math.Round(unitProfit, 2, MidpointRounding.AwayFromZero),
                ClassOf(popular, highMargin));
        })];
    }

    public static string ClassOf(bool popular, bool highMargin) => (popular, highMargin) switch
    {
        (true, true) => Star,
        (true, false) => Plowhorse,
        (false, true) => Puzzle,
        _ => Dog
    };
}
