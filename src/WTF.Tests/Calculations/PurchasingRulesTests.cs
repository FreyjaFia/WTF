using WTF.Calculations.Inventory;

namespace WTF.Tests.Calculations;

public class PurchasingRulesTests
{
    [Fact]
    public void UnitCost_DividesThePackPriceByTheUnitsInThePack() =>
        PurchasingRules.UnitCost(840m, 12m).ShouldBe(70m);

    [Fact]
    public void UnitCost_KeepsSixDecimals() =>
        PurchasingRules.UnitCost(100m, 3m).ShouldBe(33.333333m);

    [Fact]
    public void UnitCost_NoPriceOrEmptyPack_IsUnknown()
    {
        PurchasingRules.UnitCost(null, 12m).ShouldBeNull();
        PurchasingRules.UnitCost(840m, 0m).ShouldBeNull();
    }

    [Fact]
    public void UnitsFromPacks_MultipliesAndRoundsToThreeDecimals()
    {
        PurchasingRules.UnitsFromPacks(2m, 12m).ShouldBe(24m);
        PurchasingRules.UnitsFromPacks(1.5m, 0.3333m).ShouldBe(0.5m);
    }

    [Theory]
    [InlineData(100, 110, 10)]
    [InlineData(100, 90, -10)]
    [InlineData(80, 83, 3.8)]
    public void PriceChangePercent_IsRelativeToTheOldPrice(double oldPrice, double newPrice, double expected) =>
        PurchasingRules.PriceChangePercent((decimal)oldPrice, (decimal)newPrice).ShouldBe((decimal)expected);

    [Fact]
    public void PriceChangePercent_NoOldPrice_IsNull()
    {
        PurchasingRules.PriceChangePercent(null, 50m).ShouldBeNull();
        PurchasingRules.PriceChangePercent(0m, 50m).ShouldBeNull();
    }

    [Fact]
    public void CheapestIndex_SkipsUnknownCostsAndTakesTheLowest()
    {
        PurchasingRules.CheapestIndex([null, 70m, 65m, 80m]).ShouldBe(2);
        PurchasingRules.CheapestIndex([null, null]).ShouldBeNull();
        PurchasingRules.CheapestIndex([]).ShouldBeNull();
    }

    [Fact]
    public void LineTotal_IsPacksTimesPackPriceToTheCentavo()
    {
        PurchasingRules.LineTotal(2m, 840m).ShouldBe(1680m);
        PurchasingRules.LineTotal(1.5m, 33.33m).ShouldBe(50m);
        PurchasingRules.LineTotal(2m, null).ShouldBeNull();
    }

    [Fact]
    public void InvoiceDifference_IsTheTypedTotalMinusTheLines()
    {
        PurchasingRules.InvoiceDifference(1700m, [1680m, 20m]).ShouldBe(0m);
        PurchasingRules.InvoiceDifference(1700m, [1680m]).ShouldBe(20m);
        PurchasingRules.InvoiceDifference(1600m, [1680m]).ShouldBe(-80m);
    }

    [Fact]
    public void InvoiceDifference_CannotBeCheckedWithoutATotalOrWithAnUnpricedLine()
    {
        PurchasingRules.InvoiceDifference(null, [100m]).ShouldBeNull();
        PurchasingRules.InvoiceDifference(100m, [50m, null]).ShouldBeNull();
    }

    [Fact]
    public void Progress_NothingPartialOrComplete()
    {
        PurchasingRules.Progress([(4m, 0m), (2m, 0m)]).ShouldBe(OrderProgress.NothingReceived);
        PurchasingRules.Progress([(4m, 4m), (2m, 1m)]).ShouldBe(OrderProgress.Partial);
        PurchasingRules.Progress([(4m, 4m), (2m, 3m)]).ShouldBe(OrderProgress.Complete);
        PurchasingRules.Progress([]).ShouldBe(OrderProgress.NothingReceived);
    }

    [Fact]
    public void UnitsOnOrder_IsThePacksStillToComeTimesThePackSize()
    {
        PurchasingRules.UnitsOnOrder(4m, 1m, 12m).ShouldBe(36m);
        PurchasingRules.UnitsOnOrder(4m, 6m, 12m).ShouldBe(0m);
    }
}
