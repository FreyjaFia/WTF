using WTF.Calculations.Sales;

namespace WTF.Tests.Calculations;

public class ReportRulesTests
{
    [Theory]
    [InlineData(100, 80, 3, 60)]
    [InlineData(100, 100, 5, 0)]
    [InlineData(100, 120, 2, 0)]
    [InlineData(100, 0, 1, 100)]
    [InlineData(100, 80, 0, 0)]
    [InlineData(100, 80, -2, 0)]
    public void DiscountGiven_IsListMinusChargedPerUnit_NeverNegative(int original, int price, int quantity, int expected) =>
        ReportRules.DiscountGiven(original, price, quantity).ShouldBe(expected);

    [Fact]
    public void IsNewCustomer_FirstSaleOnOrAfterPeriodStart_IsNew()
    {
        var start = new DateTime(2026, 3, 1, 0, 0, 0, DateTimeKind.Utc);

        ReportRules.IsNewCustomer(start, start).ShouldBeTrue();
        ReportRules.IsNewCustomer(start.AddSeconds(1), start).ShouldBeTrue();
        ReportRules.IsNewCustomer(start.AddSeconds(-1), start).ShouldBeFalse();
    }

    [Fact]
    public void MinutesBetween_UnknownTime_IsNull()
    {
        var now = DateTime.UtcNow;

        ReportRules.MinutesBetween(null, now).ShouldBeNull();
        ReportRules.MinutesBetween(now, null).ShouldBeNull();
        ReportRules.MinutesBetween(null, null).ShouldBeNull();
    }

    [Fact]
    public void MinutesBetween_ReturnsElapsedMinutes_AndNeverNegative()
    {
        var start = new DateTime(2026, 3, 1, 10, 0, 0, DateTimeKind.Utc);

        ReportRules.MinutesBetween(start, start.AddMinutes(7.5)).ShouldBe(7.5);
        ReportRules.MinutesBetween(start, start.AddMinutes(-5)).ShouldBe(0d);
    }

    [Fact]
    public void AverageMinutes_IgnoresUnknownValues() =>
        ReportRules.AverageMinutes([10d, null, 20d]).ShouldBe(15d);

    [Fact]
    public void AverageMinutes_NoKnownValues_IsNull()
    {
        ReportRules.AverageMinutes([]).ShouldBeNull();
        ReportRules.AverageMinutes([null, null]).ShouldBeNull();
    }
}
