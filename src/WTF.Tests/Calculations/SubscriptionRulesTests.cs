using WTF.Calculations.Subscriptions;

namespace WTF.Tests.Calculations;

public class SubscriptionRulesTests
{
    private static readonly DateTime End = new(2026, 12, 1, 0, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void AccessUntil_AddsTheGraceDays()
    {
        SubscriptionRules.AccessUntil(End, 7).ShouldBe(End.AddDays(7));
        SubscriptionRules.AccessUntil(End, -3).ShouldBe(End);
    }

    [Theory]
    [InlineData(0, true)]
    [InlineData(6, true)]
    [InlineData(7, false)]
    public void AllowsAccess_StopsAtTheEndOfTheGrace(int daysAfterEnd, bool expected)
    {
        SubscriptionRules.AllowsAccess(End, 7, End.AddDays(daysAfterEnd)).ShouldBe(expected);
    }

    [Fact]
    public void NextPeriod_ExtendsFromTheEndWhenStillPaid()
    {
        var now = End.AddDays(-10);

        var (start, end) = SubscriptionRules.NextPeriod(End, now, 1);

        start.ShouldBe(End);
        end.ShouldBe(End.AddMonths(1));
    }

    [Fact]
    public void NextPeriod_StartsTodayWhenTheShopLapsed()
    {
        var now = End.AddDays(20);

        var (start, end) = SubscriptionRules.NextPeriod(End, now, 3);

        start.ShouldBe(now);
        end.ShouldBe(now.AddMonths(3));
    }

    [Fact]
    public void NextPeriod_WithoutAPeriodStartsToday()
    {
        var (start, _) = SubscriptionRules.NextPeriod(null, End, 1);

        start.ShouldBe(End);
    }

    [Theory]
    [InlineData(2500, 1, 0, 2500)]
    [InlineData(2500, 3, 0, 7500)]
    [InlineData(2500, 12, 0, 25000)]
    [InlineData(2500, 13, 0, 27500)]
    [InlineData(2500, 24, 0, 50000)]
    [InlineData(2500, 1, 50, 1250)]
    [InlineData(1500, 12, 20, 12000)]
    [InlineData(100, 0, 0, 100)]
    [InlineData(100.01, 1, 33.3, 66.71)]
    public void InvoiceAmount_ChargesTenMonthsForAYear(decimal price, int months, decimal discount, decimal expected)
    {
        SubscriptionRules.InvoiceAmount(price, months, discount).ShouldBe(expected);
    }

    [Fact]
    public void InvoiceAmount_ClampsTheDiscount()
    {
        SubscriptionRules.InvoiceAmount(1000, 1, 150).ShouldBe(0);
        SubscriptionRules.InvoiceAmount(1000, 1, -10).ShouldBe(1000);
    }
}
