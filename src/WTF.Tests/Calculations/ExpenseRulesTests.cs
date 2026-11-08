using WTF.Calculations.Sales;
using WTF.Calculations.Time;

namespace WTF.Tests.Calculations;

public class ExpenseRulesTests
{
    [Fact]
    public void Categories_AreTheEightInTheRoadmapAndOnlyOtherNeedsANote()
    {
        ExpenseCategories.All.Select(c => c.Name).ShouldBe(
            ["Rent", "Salaries", "Utilities", "Supplies", "Marketing", "Delivery", "Payment fees", "Other"]);
        ExpenseCategories.All.Select(c => c.Id).ShouldBe([(byte)1, 2, 3, 4, 5, 6, 7, 8]);
        ExpenseCategories.All.Where(c => ExpenseCategories.NeedsNote(c.Id)).Select(c => c.Name).ShouldBe(["Other"]);
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(1, true)]
    [InlineData(8, true)]
    [InlineData(9, false)]
    public void IsValid_OnlyKnownCategories(byte id, bool expected) =>
        ExpenseCategories.IsValid(id).ShouldBe(expected);

    [Fact]
    public void NameOf_AnUnknownCategory_FallsBackToOther() =>
        ExpenseCategories.NameOf(99).ShouldBe("Other");

    [Fact]
    public void OperatingProfit_TakesTheExpensesOffTheGrossProfit()
    {
        var summary = ProfitRules.OperatingProfit(1000m, 400m, 150m);

        summary.Expenses.ShouldBe(150m);
        summary.OperatingProfit.ShouldBe(250m);
        summary.MarginPercent.ShouldBe(25m);
    }

    [Fact]
    public void OperatingProfit_ExpensesAboveTheGrossProfit_IsALoss()
    {
        var summary = ProfitRules.OperatingProfit(500m, 100m, 600m);

        summary.OperatingProfit.ShouldBe(-500m);
        summary.MarginPercent.ShouldBe(-100m);
    }

    [Fact]
    public void OperatingProfit_NoSales_HasNoMarginButStillShowsTheLoss()
    {
        var summary = ProfitRules.OperatingProfit(0m, 0m, 1200m);

        summary.OperatingProfit.ShouldBe(-1200m);
        summary.MarginPercent.ShouldBeNull();
    }

    [Fact]
    public void OperatingProfit_AnUnknownGrossProfit_ShowsTheExpensesButNoProfit()
    {
        var summary = ProfitRules.OperatingProfit(800m, null, 100m);

        summary.Expenses.ShouldBe(100m);
        summary.OperatingProfit.ShouldBeNull();
        summary.MarginPercent.ShouldBeNull();
    }

    [Fact]
    public void OperatingProfit_RoundsToTheCentavo()
    {
        var summary = ProfitRules.OperatingProfit(100m, 50m, 10.005m);

        summary.Expenses.ShouldBe(10.01m);
        summary.OperatingProfit.ShouldBe(39.99m);
    }

    [Theory]
    [InlineData(ReportPeriod.Day, "2026-03-11", "2026-03-11")]
    [InlineData(ReportPeriod.Week, "2026-03-11", "2026-03-09")]
    [InlineData(ReportPeriod.Week, "2026-03-15", "2026-03-09")]
    [InlineData(ReportPeriod.Week, "2026-03-09", "2026-03-09")]
    [InlineData(ReportPeriod.Month, "2026-03-31", "2026-03-01")]
    public void PeriodStartOfLocalDate_IsTheFirstDayOfTheDayWeekOrMonth(ReportPeriod period, string date, string expected) =>
        ReportPeriods.PeriodStartOfLocalDate(DateTime.Parse(date), period).ShouldBe(DateTime.Parse(expected));
}
