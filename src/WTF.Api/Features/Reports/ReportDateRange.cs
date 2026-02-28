namespace WTF.Api.Features.Reports;

public static class ReportDateRange
{
    public static (DateTime FromUtc, DateTime ToExclusiveUtc) ToUtcRange(
        DateTime fromDate,
        DateTime toDate,
        TimeZoneInfo timeZone)
    {
        var fromLocal = DateTime.SpecifyKind(fromDate.Date, DateTimeKind.Unspecified);
        var toExclusiveLocal = DateTime.SpecifyKind(toDate.Date.AddDays(1), DateTimeKind.Unspecified);

        var fromUtc = TimeZoneInfo.ConvertTimeToUtc(fromLocal, timeZone);
        var toExclusiveUtc = TimeZoneInfo.ConvertTimeToUtc(toExclusiveLocal, timeZone);

        return (fromUtc, toExclusiveUtc);
    }

    public static DateTime EnsureUtcDate(DateTime value)
    {
        if (value.Kind == DateTimeKind.Utc)
        {
            return value;
        }

        return DateTime.SpecifyKind(value, DateTimeKind.Utc);
    }
}
