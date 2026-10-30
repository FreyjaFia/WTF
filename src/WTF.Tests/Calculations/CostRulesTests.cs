using WTF.Calculations.Inventory;

namespace WTF.Tests.Calculations;

public class CostRulesTests
{
    [Fact]
    public void WeightedAverage_BlendsOnHandAndReceived()
    {
        // 1,000 ml at 0.15 plus 1,000 ml at 0.20 is 350 over 2,000 ml.
        CostRules.WeightedAverage(1000m, 0.15m, 1000m, 0.20m).ShouldBe(0.175m);
    }

    [Fact]
    public void WeightedAverage_WeightsByQuantity()
    {
        // 300 ml at 0.10 plus 100 ml at 0.30 is 60 over 400 ml.
        CostRules.WeightedAverage(300m, 0.10m, 100m, 0.30m).ShouldBe(0.15m);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-50)]
    public void WeightedAverage_EmptyOrNegativeBalance_StartsFromTheDelivery(int onHand)
    {
        CostRules.WeightedAverage(onHand, 0.15m, 500m, 0.20m).ShouldBe(0.20m);
    }

    [Fact]
    public void WeightedAverage_NoCostYet_StartsFromTheDelivery()
    {
        CostRules.WeightedAverage(800m, null, 200m, 0.12m).ShouldBe(0.12m);
    }

    [Fact]
    public void WeightedAverage_KeepsSixDecimals()
    {
        // 1 piece at 1 plus 2 pieces at 1.5 is 4 over 3.
        CostRules.WeightedAverage(1m, 1m, 2m, 1.5m).ShouldBe(1.333333m);
    }

    [Theory]
    [InlineData(100, 10, 10)]
    [InlineData(80, 10, 12.5)]
    [InlineData(50, 0.15, 0.3)]
    public void UsableCost_DividesByTheYield(double yield, double cost, double expected)
    {
        CostRules.UsableCost((decimal)cost, (decimal)yield).ShouldBe((decimal)expected);
    }

    [Fact]
    public void UsableCost_NoCost_IsNull()
    {
        CostRules.UsableCost(null, 80m).ShouldBeNull();
    }

    [Fact]
    public void MovementCost_PrefersTheAverage()
    {
        CostRules.MovementCost(0.175m, 0.20m).ShouldBe(0.175m);
        CostRules.MovementCost(null, 0.20m).ShouldBe(0.20m);
        CostRules.MovementCost(null, null).ShouldBeNull();
    }
}
