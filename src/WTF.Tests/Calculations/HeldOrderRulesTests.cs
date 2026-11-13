using WTF.Calculations.Orders;

namespace WTF.Tests.Calculations;

public class HeldOrderRulesTests
{
    private static readonly DateTime Now = new(2026, 11, 13, 6, 0, 0, DateTimeKind.Utc);

    [Theory]
    [InlineData(0, false)]
    [InlineData(47, false)]
    [InlineData(48, false)]
    [InlineData(49, true)]
    [InlineData(200, true)]
    public void IsAged_FlagsAnOrderOlderThanTheDefaultTwoDays(int hoursAgo, bool expected)
    {
        HeldOrderRules.IsAged(Now.AddHours(-hoursAgo), Now).ShouldBe(expected);
    }

    [Fact]
    public void IsAged_ReadsTheDaysFromThePolicyWhenGiven()
    {
        HeldOrderRules.IsAged(Now.AddHours(-30), Now, 1).ShouldBeTrue();
        HeldOrderRules.IsAged(Now.AddHours(-30), Now, 3).ShouldBeFalse();
    }

    [Fact]
    public void IsAged_FallsBackToTheDefaultForANegativeValue()
    {
        HeldOrderRules.IsAged(Now.AddHours(-49), Now, -1).ShouldBeTrue();
        HeldOrderRules.IsAged(Now.AddHours(-10), Now, -1).ShouldBeFalse();
    }

    [Theory]
    [InlineData(-5, 0)]
    [InlineData(0, 0)]
    [InlineData(23, 0)]
    [InlineData(24, 1)]
    [InlineData(71, 2)]
    [InlineData(72, 3)]
    public void AgeDays_CountsWholeDays(int hoursAgo, int expected)
    {
        HeldOrderRules.AgeDays(Now.AddHours(-hoursAgo), Now).ShouldBe(expected);
    }

    [Fact]
    public void Summarize_AddsEverythingAndTheAgedPart()
    {
        var summary = HeldOrderRules.Summarize(
            [
                new HeldOrderFigure(Now.AddDays(-5), 100.50m),
                new HeldOrderFigure(Now.AddHours(-1), 49.50m, 10m, 5m),
                new HeldOrderFigure(Now.AddDays(-3), 20m, 2.5m, 1m)
            ],
            Now);

        summary.Count.ShouldBe(3);
        summary.Amount.ShouldBe(170m);
        summary.AgedCount.ShouldBe(2);
        summary.AgedAmount.ShouldBe(120.50m);
        summary.SeniorPwdDiscount.ShouldBe(12.5m);
        summary.SeniorPwdVatExempt.ShouldBe(6m);
    }

    [Fact]
    public void Summarize_NothingHeld_IsAllZero()
    {
        HeldOrderRules.Summarize([], Now).ShouldBe(new HeldOrderSummary(0, 0m, 0, 0m, 0m, 0m));
    }

    [Fact]
    public void BulkSkipReason_AnOrderWithoutSeniorPwdHoldsIsNeverSkipped()
    {
        HeldOrderRules.BulkSkipReason(["PriceChanged", "ProductInactive"], []).ShouldBeNull();
    }

    [Fact]
    public void BulkSkipReason_ASeniorPwdHoldIsSkippedWhenTheFilterDoesNotNameIt()
    {
        HeldOrderRules.BulkSkipReason(["PriceChanged", "SeniorPwdDisabled"], []).ShouldBe("SeniorPwd");
        HeldOrderRules.BulkSkipReason(["SeniorPwdDisabled"], ["PriceChanged"]).ShouldBe("SeniorPwd");
    }

    [Fact]
    public void BulkSkipReason_AFilterOnTheSeniorPwdCodeAllowsIt()
    {
        HeldOrderRules.BulkSkipReason(["SeniorPwdDisabled"], ["SeniorPwdDisabled"]).ShouldBeNull();
    }

    [Fact]
    public void BulkSkipReason_AllTheSeniorPwdCodesOfTheOrderMustBeNamed()
    {
        HeldOrderRules.BulkSkipReason(["SeniorPwdDisabled", "SeniorPwdIdMissing"], ["SeniorPwdDisabled"]).ShouldBe("SeniorPwd");
        HeldOrderRules.BulkSkipReason(["SeniorPwdDisabled", "SeniorPwdIdMissing"], ["SeniorPwdDisabled", "SeniorPwdIdMissing"]).ShouldBeNull();
    }

    [Theory]
    [InlineData(1, 100.5, "1 offline order has waited more than 2 days for review (PHP 100.50)")]
    [InlineData(3, 1234.5, "3 offline orders have waited more than 2 days for review (PHP 1,234.50)")]
    public void AgedInsightText_SaysHowManyAndHowMuch(int count, double amount, string expected)
    {
        HeldOrderRules.AgedInsightText(count, (decimal)amount).ShouldBe(expected);
    }
}
