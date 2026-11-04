using WTF.Calculations.Sales;

namespace WTF.Tests.Calculations;

public class MenuEngineeringRulesTests
{
    private static readonly Guid Latte = Guid.NewGuid();
    private static readonly Guid Mocha = Guid.NewGuid();
    private static readonly Guid Cake = Guid.NewGuid();
    private static readonly Guid Tea = Guid.NewGuid();

    [Fact]
    public void Rate_SortsTheMenuIntoTheFourGroups()
    {
        var ratings = MenuEngineeringRules.Rate(
        [
            new(Latte, 6m, 360m),
            new(Mocha, 5m, 100m),
            new(Cake, 1m, 80m),
            new(Tea, 1m, 10m)
        ]).ToDictionary(r => r.Key);

        ratings[Latte].MenuClass.ShouldBe(MenuEngineeringRules.Star);
        ratings[Mocha].MenuClass.ShouldBe(MenuEngineeringRules.Plowhorse);
        ratings[Cake].MenuClass.ShouldBe(MenuEngineeringRules.Puzzle);
        ratings[Tea].MenuClass.ShouldBe(MenuEngineeringRules.Dog);
    }

    [Fact]
    public void Rate_GivesTheShareOfUnitsAndTheProfitPerUnit()
    {
        var latte = MenuEngineeringRules.Rate([new(Latte, 6m, 360m), new(Mocha, 6m, 120m)]).First(r => r.Key == Latte);

        latte.PopularityPercent.ShouldBe(50m);
        latte.UnitProfit.ShouldBe(60m);
    }

    [Fact]
    public void Rate_AShareOfExactlySeventyPercentOfAnEvenShare_IsPopular()
    {
        // Ten items: an even share is 10%, so 7% is the line. Nine items sell 93 units between them, one sells 7.
        var items = Enumerable.Range(0, 9).Select(_ => new MenuItemSales(Guid.NewGuid(), 93m / 9m, 10m)).ToList();
        items.Add(new(Tea, 7m, 10m));

        var tea = MenuEngineeringRules.Rate(items).First(r => r.Key == Tea);

        tea.MenuClass.ShouldBe(MenuEngineeringRules.Star);
    }

    [Fact]
    public void Rate_ProfitPerUnitEqualToTheAverage_CountsAsHighMargin()
    {
        var ratings = MenuEngineeringRules.Rate([new(Latte, 3m, 30m), new(Mocha, 3m, 30m)]);

        ratings.ShouldAllBe(r => r.MenuClass == MenuEngineeringRules.Star);
    }

    [Fact]
    public void Rate_ItemsThatSoldNothingAreLeftOut_AndNothingSoldGivesNothing()
    {
        MenuEngineeringRules.Rate([new(Latte, 0m, 0m), new(Mocha, 2m, 10m)]).Select(r => r.Key).ShouldBe([Mocha]);
        MenuEngineeringRules.Rate([]).ShouldBeEmpty();
        MenuEngineeringRules.Rate([new(Latte, 0m, 0m)]).ShouldBeEmpty();
    }

    [Fact]
    public void Rate_ALossMakerBelowTheAverageIsNotHighMargin()
    {
        var ratings = MenuEngineeringRules.Rate([new(Latte, 5m, 100m), new(Mocha, 5m, -20m)]).ToDictionary(r => r.Key);

        ratings[Mocha].MenuClass.ShouldBe(MenuEngineeringRules.Plowhorse);
        ratings[Mocha].UnitProfit.ShouldBe(-4m);
    }
}
