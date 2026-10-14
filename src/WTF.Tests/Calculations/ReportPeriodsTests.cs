using WTF.Calculations.Time;

namespace WTF.Tests.Calculations;

public class ReportPeriodsTests
{
    private static readonly TimeZoneInfo Manila = TimeZoneInfo.FindSystemTimeZoneById("Asia/Manila");

    private static DateTime Utc(int y, int m, int d, int h = 0) => new(y, m, d, h, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void LocalDate_UsesTheShopTimeZone()
    {
        // 18:00 UTC on the 10th is 02:00 on the 11th in Manila (UTC+8).
        ReportPeriods.LocalDate(Utc(2026, 3, 10, 18), Manila).ShouldBe(new DateTime(2026, 3, 11));
    }

    [Fact]
    public void LocalHour_UsesTheShopTimeZone()
    {
        ReportPeriods.LocalHour(Utc(2026, 3, 10, 18), Manila).ShouldBe(2);
        ReportPeriods.LocalHour(DateTime.SpecifyKind(Utc(2026, 3, 10, 4), DateTimeKind.Unspecified), Manila).ShouldBe(12);
    }

    [Fact]
    public void PeriodStart_Day_IsTheLocalDate()
    {
        ReportPeriods.PeriodStart(Utc(2026, 3, 10, 18), ReportPeriod.Day, Manila).ShouldBe(new DateTime(2026, 3, 11));
    }

    [Theory]
    [InlineData(2026, 3, 9, 2026, 3, 9)]   // Monday starts its own week
    [InlineData(2026, 3, 11, 2026, 3, 9)]  // Wednesday
    [InlineData(2026, 3, 15, 2026, 3, 9)]  // Sunday belongs to the week that began on Monday
    [InlineData(2026, 3, 16, 2026, 3, 16)]
    public void PeriodStart_Week_StartsOnMonday(int y, int m, int d, int wy, int wm, int wd)
    {
        // Midday UTC is 20:00 in Manila, still the same calendar day.
        ReportPeriods.PeriodStart(Utc(y, m, d, 12), ReportPeriod.Week, Manila).ShouldBe(new DateTime(wy, wm, wd));
    }

    [Fact]
    public void PeriodStart_Month_IsTheFirstOfTheLocalMonth()
    {
        // 20:00 UTC on 31 Mar is already 1 April in Manila.
        ReportPeriods.PeriodStart(Utc(2026, 3, 31, 20), ReportPeriod.Month, Manila).ShouldBe(new DateTime(2026, 4, 1));
    }

    [Fact]
    public void PeriodStart_ReturnsAnUnspecifiedKindSoTheJsonCarriesNoOffset()
    {
        ReportPeriods.PeriodStart(Utc(2026, 3, 10, 4), ReportPeriod.Day, Manila).Kind.ShouldBe(DateTimeKind.Unspecified);
    }
}
