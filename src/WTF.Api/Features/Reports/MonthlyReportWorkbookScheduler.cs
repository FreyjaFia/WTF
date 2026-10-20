using Microsoft.Extensions.Options;
using WTF.Api.Services;

namespace WTF.Api.Features.Reports;

// Runs once a day after the run time and catches up after a cold start (see DailyCatchUpScheduler). "Ran today" is read
// from the current month's workbook itself: it is done for today when that file was generated today.
public sealed class MonthlyReportWorkbookScheduler(
    IServiceScopeFactory scopeFactory,
    IOptions<MonthlyReportWorkbookSchedulerOptions> options,
    ILogger<MonthlyReportWorkbookScheduler> logger) : DailyCatchUpScheduler(scopeFactory, logger)
{
    private readonly ILogger<MonthlyReportWorkbookScheduler> _logger = logger;

    private MonthlyReportWorkbookSchedulerOptions Settings => options.Value;

    protected override string JobName => "Monthly report workbook";
    protected override bool IsEnabled => Settings.Enabled;
    protected override string TimeZoneId => Settings.TimeZoneId;
    protected override int RunAtHour => Settings.RunAtHour;
    protected override int RunAtMinute => Settings.RunAtMinute;
    protected override int RetryCount => Settings.RetryCount;
    protected override int RetryDelayMinutes => Settings.RetryDelayMinutes;

    protected override async Task<DateTimeOffset?> GetLastRunUtcAsync(IServiceProvider services, CancellationToken cancellationToken)
    {
        var timeZone = ResolveTimeZone(Settings.TimeZoneId);
        var nowLocal = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, timeZone);
        var service = services.GetRequiredService<IMonthlyReportWorkbookService>();
        var status = await service.GetStatusAsync(nowLocal.Year, nowLocal.Month, cancellationToken);

        if (status is { Exists: true, GeneratedAtUtc: not null })
        {
            return new DateTimeOffset(DateTime.SpecifyKind(status.GeneratedAtUtc.Value, DateTimeKind.Utc), TimeSpan.Zero);
        }

        // On the 1st nothing has been completed this month yet, so the current file cannot exist. The day's work is then
        // the previous month's file: once it exists there is nothing left to do today.
        if (nowLocal.Day == 1)
        {
            var previous = nowLocal.AddMonths(-1);
            var previousStatus = await service.GetStatusAsync(previous.Year, previous.Month, cancellationToken);
            if (previousStatus is { Exists: true })
            {
                return DateTimeOffset.UtcNow;
            }
        }

        return null;
    }

    protected override async Task RunJobAsync(IServiceProvider services, CancellationToken cancellationToken)
    {
        var timeZone = ResolveTimeZone(Settings.TimeZoneId);
        var nowLocal = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, timeZone);
        var service = services.GetRequiredService<IMonthlyReportWorkbookService>();

        if (nowLocal.Day == 1)
        {
            await GeneratePreviousMonthIfMissingAsync(service, nowLocal.AddMonths(-1), timeZone, cancellationToken);
        }

        await GenerateToDateAsync(service, nowLocal, timeZone, cancellationToken);
    }

    private async Task GeneratePreviousMonthIfMissingAsync(
        IMonthlyReportWorkbookService service,
        DateTimeOffset previousMonthLocal,
        TimeZoneInfo timeZone,
        CancellationToken stoppingToken)
    {
        var status = await service.GetStatusAsync(
            previousMonthLocal.Year,
            previousMonthLocal.Month,
            stoppingToken);

        if (status is { Exists: true })
        {
            return;
        }

        await service.GenerateAsync(
            previousMonthLocal.Year,
            previousMonthLocal.Month,
            timeZone.Id,
            stoppingToken);

        _logger.LogInformation(
            "Monthly report workbook generated for previous month {Year}-{Month:00}.",
            previousMonthLocal.Year,
            previousMonthLocal.Month);
    }

    private async Task GenerateToDateAsync(
        IMonthlyReportWorkbookService service,
        DateTimeOffset nowLocal,
        TimeZoneInfo timeZone,
        CancellationToken stoppingToken)
    {
        var throughDate = nowLocal.Date.AddDays(-1);
        var monthStart = new DateTime(nowLocal.Year, nowLocal.Month, 1);
        if (throughDate < monthStart)
        {
            _logger.LogInformation(
                "Monthly report workbook catch-up skipped (no completed days yet for {Year}-{Month:00}).",
                nowLocal.Year,
                nowLocal.Month);
            return;
        }

        await service.GenerateThroughDateAsync(
            nowLocal.Year,
            nowLocal.Month,
            throughDate,
            timeZone.Id,
            new DateTime(
                throughDate.Year,
                throughDate.Month,
                throughDate.Day,
                23,
                59,
                0,
                DateTimeKind.Unspecified),
            stoppingToken);

        _logger.LogInformation(
            "Monthly report workbook regenerated through end of day {Date:yyyy-MM-dd}.",
            throughDate);
    }

    private static TimeZoneInfo ResolveTimeZone(string timeZoneId) => DailyCatchUpScheduler.ResolveTimeZone(timeZoneId);
}
