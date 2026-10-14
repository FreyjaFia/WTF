namespace WTF.Tests.Features.Pricing;

public class CalculateDiscountedUnitPriceTests
{
    [Fact]
    public void Calculate_FixedPrice_SubtractsAmountFromBase()
    {
        PricingTestHelpers.Calculate(100m, 30m, null).ShouldBe(70m);
    }

    [Fact]
    public void Calculate_FixedPriceLargerThanBase_ClampsToZero()
    {
        PricingTestHelpers.Calculate(20m, 50m, null).ShouldBe(0m);
    }

    [Fact]
    public void Calculate_FixedPriceEqualToBase_IsZero()
    {
        PricingTestHelpers.Calculate(20m, 20m, null).ShouldBe(0m);
    }

    [Fact]
    public void Calculate_FixedPrice_IsNotRounded()
    {
        PricingTestHelpers.Calculate(10m, 1.005m, null).ShouldBe(8.995m);
    }

    [Fact]
    public void Calculate_PercentOff_ReducesByPercent()
    {
        PricingTestHelpers.Calculate(200m, null, 25m).ShouldBe(150m);
    }

    [Fact]
    public void Calculate_Percent100_IsFree()
    {
        PricingTestHelpers.Calculate(80m, null, 100m).ShouldBe(0m);
    }

    [Fact]
    public void Calculate_PercentOff_RoundsToTwoDecimals()
    {
        PricingTestHelpers.Calculate(10m, null, 33.33m).ShouldBe(6.67m);
    }

    [Fact]
    public void Calculate_PercentOffMidpoint_RoundsAwayFromZero()
    {
        // 10.01 * 0.5 = 5.005 -> 5.01 (banker rounding would give 5.00)
        PricingTestHelpers.Calculate(10.01m, null, 50m).ShouldBe(5.01m);
        // 0.05 * 0.5 = 0.025 -> 0.03
        PricingTestHelpers.Calculate(0.05m, null, 50m).ShouldBe(0.03m);
    }

    [Fact]
    public void Calculate_FixedAndPercent_FixedWins()
    {
        PricingTestHelpers.Calculate(100m, 10m, 50m).ShouldBe(90m);
    }

    [Fact]
    public void Calculate_ZeroFixedWithPercent_FallsBackToPercent()
    {
        PricingTestHelpers.Calculate(100m, 0m, 50m).ShouldBe(50m);
    }

    [Fact]
    public void Calculate_NegativeFixedWithPercent_FallsBackToPercent()
    {
        PricingTestHelpers.Calculate(100m, -5m, 20m).ShouldBe(80m);
    }

    [Fact]
    public void Calculate_NoValues_ReturnsNull()
    {
        PricingTestHelpers.Calculate(100m, null, null).ShouldBeNull();
    }

    [Fact]
    public void Calculate_ZeroValues_ReturnsNull()
    {
        PricingTestHelpers.Calculate(100m, 0m, 0m).ShouldBeNull();
    }

    [Fact]
    public void Calculate_NegativeValues_ReturnsNull()
    {
        PricingTestHelpers.Calculate(100m, -1m, -10m).ShouldBeNull();
    }

    [Fact]
    public void Calculate_ZeroBasePrice_StaysZero()
    {
        PricingTestHelpers.Calculate(0m, 5m, null).ShouldBe(0m);
        PricingTestHelpers.Calculate(0m, null, 50m).ShouldBe(0m);
    }

    [Fact]
    public void Calculate_ValidDiscount_NeverExceedsBasePrice()
    {
        foreach (var basePrice in new[] { 0m, 0.01m, 9.99m, 100m, 1234.56m })
        {
            foreach (var fixedPrice in new decimal?[] { null, 0.01m, 5m, 5000m })
            {
                foreach (var pct in new decimal?[] { null, 0.01m, 10m, 99.99m, 100m })
                {
                    var result = PricingTestHelpers.Calculate(basePrice, fixedPrice, pct);
                    if (result is null)
                        continue;
                    result.Value.ShouldBeGreaterThanOrEqualTo(0m);
                    result.Value.ShouldBeLessThanOrEqualTo(basePrice);
                }
            }
        }
    }

    [Fact]
    public void Calculate_PercentOverHundred_NeverBelowZero()
    {
        PricingTestHelpers.Calculate(100m, null, 150m).ShouldBe(0m);
    }
}
