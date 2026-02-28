namespace WTF.Api.Features.Reports;

public static class ReportDateRange
{
    public static (DateTime FromUtc, DateTime ToExclusiveUtc) ToUtcRange(DateTime fromDate, DateTime toDate)
    {
        var fromUtc = EnsureUtcDate(fromDate.Date);
        var toExclusiveUtc = EnsureUtcDate(toDate.Date.AddDays(1));
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
