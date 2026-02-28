namespace WTF.Api.Features.Reports;

public sealed class MonthlyReportWorkbookSchedulerOptions
{
    public const string SectionName = "MonthlyReportWorkbookScheduler";

    public bool Enabled { get; set; } = true;

    public string TimeZoneId { get; set; } = "Asia/Manila";

    public int RunAtHour { get; set; } = 0;

    public int RunAtMinute { get; set; } = 0;
}
