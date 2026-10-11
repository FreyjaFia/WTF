namespace WTF.Tests.Features.Pricing;

public class CalculateDiscountedUnitPriceTests
{
    public static IEnumerable<object[]> Copies() => PricingCopies.CopyNames.Select(c => new object[] { c });

    [Theory]
    [MemberData(nameof(Copies))]
    public void Calculate_FixedPrice_SubtractsAmountFromBase(string copy)
    {
        PricingCopies.Calculate(copy, 100m, 30m, null).ShouldBe(70m);
    }

    [Theory]
    [MemberData(nameof(Copies))]
    public void Calculate_FixedPriceLargerThanBase_ClampsToZero(string copy)
    {
        PricingCopies.Calculate(copy, 20m, 50m, null).ShouldBe(0m);
    }

    [Theory]
    [MemberData(nameof(Copies))]
    public void Calculate_FixedPriceEqualToBase_IsZero(string copy)
    {
        PricingCopies.Calculate(copy, 20m, 20m, null).ShouldBe(0m);
    }

    [Theory]
    [MemberData(nameof(Copies))]
    public void Calculate_FixedPrice_IsNotRounded(string copy)
    {
        PricingCopies.Calculate(copy, 10m, 1.005m, null).ShouldBe(8.995m);
    }

    [Theory]
    [MemberData(nameof(Copies))]
    public void Calculate_PercentOff_ReducesByPercent(string copy)
    {
        PricingCopies.Calculate(copy, 200m, null, 25m).ShouldBe(150m);
    }

    [Theory]
    [MemberData(nameof(Copies))]
    public void Calculate_Percent100_IsFree(string copy)
    {
        PricingCopies.Calculate(copy, 80m, null, 100m).ShouldBe(0m);
    }

    [Theory]
    [MemberData(nameof(Copies))]
    public void Calculate_PercentOff_RoundsToTwoDecimals(string copy)
    {
        PricingCopies.Calculate(copy, 10m, null, 33.33m).ShouldBe(6.67m);
    }

    [Theory]
    [MemberData(nameof(Copies))]
    public void Calculate_PercentOffMidpoint_RoundsAwayFromZero(string copy)
    {
        // 10.01 * 0.5 = 5.005 -> 5.01 (banker rounding would give 5.00)
        PricingCopies.Calculate(copy, 10.01m, null, 50m).ShouldBe(5.01m);
        // 0.05 * 0.5 = 0.025 -> 0.03
        PricingCopies.Calculate(copy, 0.05m, null, 50m).ShouldBe(0.03m);
    }

    [Theory]
    [MemberData(nameof(Copies))]
    public void Calculate_FixedAndPercent_FixedWins(string copy)
    {
        PricingCopies.Calculate(copy, 100m, 10m, 50m).ShouldBe(90m);
    }

    [Theory]
    [MemberData(nameof(Copies))]
    public void Calculate_ZeroFixedWithPercent_FallsBackToPercent(string copy)
    {
        PricingCopies.Calculate(copy, 100m, 0m, 50m).ShouldBe(50m);
    }

    [Theory]
    [MemberData(nameof(Copies))]
    public void Calculate_NegativeFixedWithPercent_FallsBackToPercent(string copy)
    {
        PricingCopies.Calculate(copy, 100m, -5m, 20m).ShouldBe(80m);
    }

    [Theory]
    [MemberData(nameof(Copies))]
    public void Calculate_NoValues_ReturnsNull(string copy)
    {
        PricingCopies.Calculate(copy, 100m, null, null).ShouldBeNull();
    }

    [Theory]
    [MemberData(nameof(Copies))]
    public void Calculate_ZeroValues_ReturnsNull(string copy)
    {
        PricingCopies.Calculate(copy, 100m, 0m, 0m).ShouldBeNull();
    }

    [Theory]
    [MemberData(nameof(Copies))]
    public void Calculate_NegativeValues_ReturnsNull(string copy)
    {
        PricingCopies.Calculate(copy, 100m, -1m, -10m).ShouldBeNull();
    }

    [Theory]
    [MemberData(nameof(Copies))]
    public void Calculate_ZeroBasePrice_StaysZero(string copy)
    {
        PricingCopies.Calculate(copy, 0m, 5m, null).ShouldBe(0m);
        PricingCopies.Calculate(copy, 0m, null, 50m).ShouldBe(0m);
    }

    [Theory]
    [MemberData(nameof(Copies))]
    public void Calculate_ValidDiscount_NeverExceedsBasePrice(string copy)
    {
        foreach (var basePrice in new[] { 0m, 0.01m, 9.99m, 100m, 1234.56m })
        {
            foreach (var fixedPrice in new decimal?[] { null, 0.01m, 5m, 5000m })
            {
                foreach (var pct in new decimal?[] { null, 0.01m, 10m, 99.99m, 100m })
                {
                    var result = PricingCopies.Calculate(copy, basePrice, fixedPrice, pct);
                    if (result is null) continue;
                    result.Value.ShouldBeGreaterThanOrEqualTo(0m);
                    result.Value.ShouldBeLessThanOrEqualTo(basePrice);
                }
            }
        }
    }

    [Theory]
    [MemberData(nameof(Copies))]
    public void Calculate_PercentOverHundred_NeverBelowZero(string copy)
    {
        PricingCopies.Calculate(copy, 100m, null, 150m).ShouldBe(0m);
    }

    [Fact]
    public void Calculate_AllCopies_ReturnIdenticalResultsForSameInputs()
    {
        var bases = new[] { 0m, 0.05m, 9.99m, 10.01m, 100m, 1234.56m };
        var fixeds = new decimal?[] { null, -1m, 0m, 0.01m, 5m, 1.005m, 5000m };
        var pcts = new decimal?[] { null, -10m, 0m, 0.01m, 12.5m, 33.33m, 50m, 99.99m, 100m, 150m };

        foreach (var b in bases)
        foreach (var f in fixeds)
        foreach (var p in pcts)
        {
            var create = PricingCopies.Calculate("Create", b, f, p);
            PricingCopies.Calculate("Update", b, f, p).ShouldBe(create, $"Update differs for base={b} fixed={f} pct={p}");
            PricingCopies.Calculate("Evaluate", b, f, p).ShouldBe(create, $"Evaluate differs for base={b} fixed={f} pct={p}");
        }
    }
}
