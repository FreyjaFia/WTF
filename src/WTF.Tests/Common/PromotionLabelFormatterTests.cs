using WTF.Calculations.Orders;

namespace WTF.Tests.Common;

public class PromotionLabelFormatterTests
{
    [Fact]
    public void Format_FixedAmount_FormatsWithTwoDecimals()
    {
        PromotionLabelFormatter.Format(25m, null).ShouldBe("Promo -₱25.00");
    }

    [Fact]
    public void Format_Percent_TrimsTrailingZeros()
    {
        PromotionLabelFormatter.Format(null, 10m).ShouldBe("Promo -10%");
        PromotionLabelFormatter.Format(null, 12.5m).ShouldBe("Promo -12.5%");
    }

    [Fact]
    public void Format_BothSet_FixedAmountWins()
    {
        PromotionLabelFormatter.Format(5m, 10m).ShouldBe("Promo -₱5.00");
    }

    [Fact]
    public void Format_NothingPositive_ReturnsNull()
    {
        PromotionLabelFormatter.Format(null, null).ShouldBeNull();
        PromotionLabelFormatter.Format(0m, 0m).ShouldBeNull();
        PromotionLabelFormatter.Format(-1m, -5m).ShouldBeNull();
    }

    [Fact]
    public void Format_ZeroFixedWithPercent_FallsBackToPercent()
    {
        PromotionLabelFormatter.Format(0m, 20m).ShouldBe("Promo -20%");
    }
}
