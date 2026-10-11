using WTF.Api.Features.Reports;

namespace WTF.Tests.Features.Reports;

public class ReportDateRangeTests
{
    [Fact]
    public void ToUtcRange_UtcZone_IsInclusiveStartAndExclusiveEnd()
    {
        var (from, to) = ReportDateRange.ToUtcRange(
            new DateTime(2025, 3, 1, 15, 0, 0),
            new DateTime(2025, 3, 3, 9, 0, 0),
            TimeZoneInfo.Utc);

        from.ShouldBe(new DateTime(2025, 3, 1));
        to.ShouldBe(new DateTime(2025, 3, 4));
    }

    [Fact]
    public void ToUtcRange_PlusEightZone_ShiftsBackEightHours()
    {
        var zone = TimeZoneInfo.CreateCustomTimeZone("test", TimeSpan.FromHours(8), "test", "test");

        var (from, to) = ReportDateRange.ToUtcRange(new DateTime(2025, 3, 1), new DateTime(2025, 3, 1), zone);

        from.ShouldBe(new DateTime(2025, 2, 28, 16, 0, 0));
        to.ShouldBe(new DateTime(2025, 3, 1, 16, 0, 0));
    }

    [Fact]
    public void EnsureUtcDate_UtcKind_ReturnsSameInstant()
    {
        var value = new DateTime(2025, 1, 1, 5, 0, 0, DateTimeKind.Utc);

        ReportDateRange.EnsureUtcDate(value).ShouldBe(value);
    }

    [Theory]
    [InlineData(DateTimeKind.Local)]
    [InlineData(DateTimeKind.Unspecified)]
    public void EnsureUtcDate_OtherKinds_RelabelsAsUtcWithoutShifting(DateTimeKind kind)
    {
        var value = new DateTime(2025, 1, 1, 5, 0, 0, kind);

        var result = ReportDateRange.EnsureUtcDate(value);

        result.Kind.ShouldBe(DateTimeKind.Utc);
        result.Ticks.ShouldBe(value.Ticks);
    }
}
