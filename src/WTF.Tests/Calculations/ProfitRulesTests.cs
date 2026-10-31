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
}
