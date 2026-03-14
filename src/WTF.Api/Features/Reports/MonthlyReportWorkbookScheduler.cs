using Microsoft.Extensions.Options;

namespace WTF.Api.Features.Reports;

public sealed class MonthlyReportWorkbookScheduler(
    IServiceScopeFactory scopeFactory,
    IOptions<MonthlyReportWorkbookSchedulerOptions> options,
    ILogger<MonthlyReportWorkbookScheduler> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var settings = options.Value;
        if (!settings.Enabled)
        {
            logger.LogInformation("Monthly report workbook scheduler is disabled.");
            return;
        }

        var timeZone = ResolveTimeZone(settings.TimeZoneId);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await EnsureGeneratedForTodayAsync(
                    timeZone,
                    settings,
                    stoppingToken);

                var delay = GetNextDelay(timeZone, settings.RunAtHour, settings.RunAtMinute);
                logger.LogInformation(
                    "Monthly report workbook scheduler sleeping for {Delay}. Next run at local {LocalTime}.",
                    delay,
                    TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow.Add(delay), timeZone));

                await Task.Delay(delay, stoppingToken);

                var nowLocal = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, timeZone);
                using var scope = scopeFactory.CreateScope();
                var service = scope.ServiceProvider.GetRequiredService<IMonthlyReportWorkbookService>();
                await GenerateToDateAsync(
                    service,
                    nowLocal,
                    timeZone,
                    stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                logger.LogInformation("Monthly report workbook scheduler is stopping.");
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to regenerate monthly report workbook.");
            }
        }
    }

    private async Task EnsureGeneratedForTodayAsync(
        TimeZoneInfo timeZone,
        MonthlyReportWorkbookSchedulerOptions settings,
        CancellationToken stoppingToken)
    {
        var nowLocal = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, timeZone);
        using var scope = scopeFactory.CreateScope();
        var service = scope.ServiceProvider.GetRequiredService<IMonthlyReportWorkbookService>();
        var status = await service.GetStatusAsync(nowLocal.Year, nowLocal.Month, stoppingToken);

        if (nowLocal.Day == 1)
        {
            var previousMonth = nowLocal.AddMonths(-1);
            await GeneratePreviousMonthIfMissingAsync(
                service,
                previousMonth,
                timeZone,
                stoppingToken);
        }

        if (status is { Exists: true, GeneratedAtUtc: not null })
        {
            var lastModifiedLocal = TimeZoneInfo.ConvertTime(
                new DateTimeOffset(DateTime.SpecifyKind(status.GeneratedAtUtc.Value, DateTimeKind.Utc), TimeSpan.Zero),
                timeZone);

            if (lastModifiedLocal.Date == nowLocal.Date)
            {
                return;
            }
        }

        await GenerateToDateAsync(
            service,
            nowLocal,
            timeZone,
            stoppingToken);
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

        logger.LogInformation(
            "Monthly report workbook generated for previous month {Year}-{Month:00}.",
            previousMonthLocal.Year,
            previousMonthLocal.Month);
    }

    private static TimeSpan GetNextDelay(TimeZoneInfo timeZone, int runAtHour, int runAtMinute)
    {
        var nowUtc = DateTimeOffset.UtcNow;
        var nowLocal = TimeZoneInfo.ConvertTime(nowUtc, timeZone);

        var nextLocal = new DateTimeOffset(
            nowLocal.Year,
            nowLocal.Month,
            nowLocal.Day,
            runAtHour,
            runAtMinute,
            0,
            nowLocal.Offset);

        if (nextLocal <= nowLocal)
        {
            nextLocal = nextLocal.AddDays(1);
        }

        var nextUtc = nextLocal.ToUniversalTime();
        var delay = nextUtc - nowUtc;
        return delay <= TimeSpan.Zero ? TimeSpan.FromMinutes(1) : delay;
    }

    private static TimeZoneInfo ResolveTimeZone(string timeZoneId)
    {
        if (string.IsNullOrWhiteSpace(timeZoneId))
        {
            return TimeZoneInfo.Utc;
        }

        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        }
        catch (TimeZoneNotFoundException)
        {
            if (TimeZoneInfo.TryConvertIanaIdToWindowsId(timeZoneId, out var windowsId))
            {
                return TimeZoneInfo.FindSystemTimeZoneById(windowsId);
            }

            return TimeZoneInfo.Utc;
        }
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
            logger.LogInformation(
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
            stoppingToken);

        logger.LogInformation(
            "Monthly report workbook regenerated through end of day {Date:yyyy-MM-dd}.",
            throughDate);
    }
}
