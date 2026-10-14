namespace WTF.Calculations.Time;

public enum ReportPeriod
{
    Day,
    Week,
    Month
}

/// <summary>Turns a stored UTC time into the shop's local day, hour or reporting period.</summary>
public static class ReportPeriods
{
    public static DateTime LocalDate(DateTime createdAtUtc, TimeZoneInfo timeZone) =>
        TimeZoneInfo.ConvertTimeFromUtc(ReportDateRange.EnsureUtcDate(createdAtUtc), timeZone).Date;

    public static int LocalHour(DateTime createdAtUtc, TimeZoneInfo timeZone) =>
        TimeZoneInfo.ConvertTimeFromUtc(ReportDateRange.EnsureUtcDate(createdAtUtc), timeZone).Hour;

    public static DateTime LocalDateTime(DateTime createdAtUtc, TimeZoneInfo timeZone) =>
        DateTime.SpecifyKind(
            TimeZoneInfo.ConvertTimeFromUtc(ReportDateRange.EnsureUtcDate(createdAtUtc), timeZone),
            DateTimeKind.Unspecified);

    /// <summary>The first local day of the day, Monday-based week or month that contains the order.</summary>
    public static DateTime PeriodStart(DateTime createdAtUtc, ReportPeriod period, TimeZoneInfo timeZone)
    {
        var localDate = LocalDate(createdAtUtc, timeZone);

        if (period == ReportPeriod.Week)
        {
            var offset = ((int)localDate.DayOfWeek + 6) % 7;
            return DateTime.SpecifyKind(localDate.AddDays(-offset), DateTimeKind.Unspecified);
        }

        if (period == ReportPeriod.Month)
        {
            return DateTime.SpecifyKind(new DateTime(localDate.Year, localDate.Month, 1), DateTimeKind.Unspecified);
        }

        return DateTime.SpecifyKind(localDate, DateTimeKind.Unspecified);
    }
}
