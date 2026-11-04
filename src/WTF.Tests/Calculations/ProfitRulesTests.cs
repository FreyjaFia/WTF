using WTF.Calculations.Sales;

namespace WTF.Tests.Calculations;

public class ProfitRulesTests
{
    [Fact]
    public void AllocateByUnits_SplitsInProportionAndAddsUpToTheTotal()
    {
        var shares = ProfitRules.AllocateByUnits(30m, [1m, 2m]);

        shares.ShouldBe([10m, 20m]);
        shares.Sum().ShouldBe(30m);
    }

    [Fact]
    public void AllocateByUnits_TheLastShareTakesTheRounding()
    {
        var shares = ProfitRules.AllocateByUnits(10m, [1m, 1m, 1m]);

        shares.Sum().ShouldBe(10m);
        shares[0].ShouldBe(3.333333m);
        shares[2].ShouldBe(3.333334m);
    }

    [Fact]
    public void AllocateByUnits_OneLineGetsEverything_AndNoUnitsGetsNothing()
    {
        ProfitRules.AllocateByUnits(12.5m, [3m]).ShouldBe([12.5m]);
        ProfitRules.AllocateByUnits(12.5m, [0m, 0m]).ShouldBe([0m, 0m]);
        ProfitRules.AllocateByUnits(12.5m, []).ShouldBeEmpty();
    }

    [Theory]
    [InlineData(40, 10, 20)]
    [InlineData(0, 10, 100)]
    [InlineData(50, 0, 0)]
    public void WastePercent_IsTheShareOfWhatWasUsed(double salesCost, double wasteCost, double expected)
    {
        ProfitRules.WastePercent((decimal)salesCost, (decimal)wasteCost).ShouldBe((decimal)expected);
    }

    [Fact]
    public void WastePercent_NothingUsedHasNoShare()
    {
        ProfitRules.WastePercent(0m, 0m).ShouldBeNull();
    }

    [Fact]
    public void CombineCostStatus_KnownOnlyWhenEveryPeriodIs()
    {
        ProfitRules.CombineCostStatus([]).ShouldBe("Known");
        ProfitRules.CombineCostStatus(["Known", "Known"]).ShouldBe("Known");
        ProfitRules.CombineCostStatus(["Known", "Partly known"]).ShouldBe("Partly known");
        ProfitRules.CombineCostStatus(["Known", "No cost"]).ShouldBe("Partly known");
        ProfitRules.CombineCostStatus(["No cost", "No cost"]).ShouldBe("No cost");
    }

    [Theory]
    [InlineData(5, 0, CostCoverage.Known)]
    [InlineData(0, 0, CostCoverage.Known)]
    [InlineData(3, 2, CostCoverage.Partly)]
    [InlineData(0, 4, CostCoverage.Unknown)]
    public void Coverage_FollowsHowManyUnitsHaveACost(double costed, double uncosted, CostCoverage expected)
    {
        ProfitRules.Coverage((decimal)costed, (decimal)uncosted).ShouldBe(expected);
    }

    [Fact]
    public void MarginPercent_IsProfitOverRevenue_AndNullWithoutRevenue()
    {
        ProfitRules.MarginPercent(300m, 250m).ShouldBe(83.33m);
        ProfitRules.MarginPercent(10m, -6m).ShouldBe(-60m);
        ProfitRules.MarginPercent(0m, 0m).ShouldBeNull();
    }

    [Theory]
    [InlineData(-420, 0.1, 42)]
    [InlineData(200, 0.1, -20)]
    [InlineData(0, 5, 0)]
    public void MovementCost_StockLeavingIsACost_AndStockComingBackGivesItBack(double delta, double unitCost, double expected)
    {
        ProfitRules.MovementCost((decimal)delta, (decimal)unitCost).ShouldBe((decimal)expected);
    }

    [Fact]
    public void GrossProfit_TakesWasteAndVarianceOffTheTheoreticalProfit()
    {
        var summary = ProfitRules.GrossProfit(300m, 50m, 10m, 2m);

        summary.TheoreticalProfit.ShouldBe(250m);
        summary.ActualProfit.ShouldBe(238m);
        summary.MarginPercent.ShouldBe(79.33m);
    }

    [Fact]
    public void GrossProfit_ASurplusRaisesTheProfit_AndNoSalesHasNoMargin()
    {
        ProfitRules.GrossProfit(150m, 20m, 0m, -5m).ActualProfit.ShouldBe(135m);

        var none = ProfitRules.GrossProfit(0m, 0m, 30m, 0m);
        none.ActualProfit.ShouldBe(-30m);
        none.MarginPercent.ShouldBeNull();
    }

    [Theory]
    [InlineData(CostCoverage.Known, false, "Known")]
    [InlineData(CostCoverage.Known, true, "Partly known")]
    [InlineData(CostCoverage.Partly, false, "Partly known")]
    [InlineData(CostCoverage.Unknown, false, "No cost")]
    [InlineData(CostCoverage.Unknown, true, "No cost")]
    public void CostStatus_NamesHowFarTheCostCanBeTrusted(CostCoverage coverage, bool unpricedLoss, string expected)
    {
        ProfitRules.CostStatus(coverage, unpricedLoss).ShouldBe(expected);
    }
}
