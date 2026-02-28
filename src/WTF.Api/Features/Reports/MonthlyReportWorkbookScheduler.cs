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
            var delay = GetNextDelay(timeZone, settings.RunAtHour, settings.RunAtMinute);
            logger.LogInformation(
                "Monthly report workbook scheduler sleeping for {Delay}. Next run at local {LocalTime}.",
                delay,
                TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow.Add(delay), timeZone));

            await Task.Delay(delay, stoppingToken);

            try
            {
                var nowLocal = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, timeZone);
                using var scope = scopeFactory.CreateScope();
                var service = scope.ServiceProvider.GetRequiredService<IMonthlyReportWorkbookService>();
                await service.GenerateAsync(
                    nowLocal.Year,
                    nowLocal.Month,
                    timeZone.Id,
                    stoppingToken);

                logger.LogInformation(
                    "Monthly report workbook regenerated for {Year}-{Month:00}.",
                    nowLocal.Year,
                    nowLocal.Month);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to regenerate monthly report workbook.");
            }
        }
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
}
