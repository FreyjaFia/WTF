using WTF.Calculations.Inventory;

namespace WTF.Tests.Calculations;

public class ReorderRulesTests
{
    [Theory]
    [InlineData(20, 5, 0, true)]
    [InlineData(20, 20, 0, false)]
    [InlineData(20, 5, 15, false)]
    [InlineData(20, 5, 10, true)]
    public void IsBelowPar_CountsWhatIsOnOrder(double par, double onHand, double onOrder, bool expected) =>
        ReorderRules.IsBelowPar((decimal)par, (decimal)onHand, (decimal)onOrder).ShouldBe(expected);

    [Fact]
    public void IsBelowPar_NoParLevel_IsNeverOnTheList() =>
        ReorderRules.IsBelowPar(null, 0m, 0m).ShouldBeFalse();

    [Fact]
    public void Suggest_RoundsUpToWholePacks()
    {
        var suggestion = ReorderRules.Suggest(48m, 10m, 0m, 12m)!;

        suggestion.Needed.ShouldBe(38m);
        suggestion.Packs.ShouldBe(4m);
        suggestion.Units.ShouldBe(48m);
    }

    [Fact]
    public void Suggest_SubtractsWhatIsOnOrder()
    {
        var suggestion = ReorderRules.Suggest(48m, 10m, 24m, 12m)!;

        suggestion.Needed.ShouldBe(14m);
        suggestion.Packs.ShouldBe(2m);
    }

    [Fact]
    public void Suggest_WithoutAPackSize_RoundsUpToWholeUnits()
    {
        var suggestion = ReorderRules.Suggest(10m, 2.5m, 0m, null)!;

        suggestion.Packs.ShouldBeNull();
        suggestion.Units.ShouldBe(8m);
    }

    [Fact]
    public void Suggest_NegativeBalanceCountsAsEmpty() =>
        ReorderRules.Suggest(10m, -4m, 0m, null)!.Needed.ShouldBe(10m);

    [Fact]
    public void Suggest_AtOrAbovePar_OrWithoutPar_IsNothing()
    {
        ReorderRules.Suggest(10m, 10m, 0m, 6m).ShouldBeNull();
        ReorderRules.Suggest(null, 0m, 0m, 6m).ShouldBeNull();
    }

    [Fact]
    public void AverageDailyUsage_IsTheNetUnitsOverTheDays()
    {
        ReorderRules.AverageDailyUsage(56m, 28).ShouldBe(2m);
        ReorderRules.AverageDailyUsage(-3m, 28).ShouldBe(0m);
        ReorderRules.AverageDailyUsage(10m, 0).ShouldBe(0m);
    }

    [Fact]
    public void DaysOfCover_IsOnHandOverTheDailyPace()
    {
        ReorderRules.DaysOfCover(9m, 2m).ShouldBe(4.5m);
        ReorderRules.DaysOfCover(-1m, 2m).ShouldBe(0m);
        ReorderRules.DaysOfCover(9m, 0m).ShouldBeNull();
    }
}
