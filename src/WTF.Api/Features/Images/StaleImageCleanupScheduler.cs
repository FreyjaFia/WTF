using Microsoft.Extensions.Options;

namespace WTF.Api.Features.Images;

/// <summary>
/// Runs the stale image cleanup once a day. The app is hosted where it goes cold, so a plain "sleep until 02:00"
/// would be lost whenever the process is recycled. Instead every pass asks "is today's run due?" using the last run
/// saved in storage: starting the app after 02:00 catches up at once, and a wake-up that oversleeps still runs.
/// </summary>
public sealed class StaleImageCleanupScheduler(
    IServiceScopeFactory scopeFactory,
    IOptions<StaleImageCleanupOptions> options,
    ILogger<StaleImageCleanupScheduler> logger) : BackgroundService
{
    // Wake up at least this often, so a suspended host or a clock change cannot push the run a whole day late.
    private static readonly TimeSpan MaxSleep = TimeSpan.FromMinutes(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var settings = options.Value;
        if (!settings.Enabled || settings.RetentionDays <= 0)
        {
            logger.LogInformation("Stale image cleanup scheduler is disabled.");
            return;
        }

        var timeZone = ResolveTimeZone(settings.TimeZoneId);
        var failures = 0;
        while (!stoppingToken.IsCancellationRequested)
        {
            TimeSpan wait;
            try
            {
                await RunIfDueAsync(timeZone, settings, stoppingToken);
                failures = 0;
                wait = Min(GetNextDelay(timeZone, settings.RunAtHour, settings.RunAtMinute), MaxSleep);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                failures++;
                logger.LogError(ex, "Stale image cleanup failed (attempt {Attempt}).", failures);

                // A few quick retries, then give up until the next scheduled run (the next pass sees it is still due).
                if (failures <= settings.RetryCount)
                {
                    wait = TimeSpan.FromMinutes(Math.Max(1, settings.RetryDelayMinutes));
                }
                else
                {
                    failures = 0;
                    wait = Min(GetNextDelay(timeZone, settings.RunAtHour, settings.RunAtMinute), MaxSleep);
                }
            }

            try
            {
                await Task.Delay(wait, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }

        logger.LogInformation("Stale image cleanup scheduler is stopping.");
    }

    private async Task RunIfDueAsync(TimeZoneInfo timeZone, StaleImageCleanupOptions settings, CancellationToken stoppingToken)
    {
        var nowLocal = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, timeZone);
        if (!IsPastRunTime(nowLocal, settings.RunAtHour, settings.RunAtMinute))
        {
            return;
        }

        using var scope = scopeFactory.CreateScope();
        var service = scope.ServiceProvider.GetRequiredService<IStaleImageCleanupService>();
        var last = await service.GetLastRunAsync(stoppingToken);
        if (last is not null && TimeZoneInfo.ConvertTime(last.RanAtUtc, timeZone).Date == nowLocal.Date)
        {
            return;
        }

        logger.LogInformation("Stale image cleanup is due; running now.");
        await service.RunAsync(stoppingToken);
    }

    internal static bool IsPastRunTime(DateTimeOffset nowLocal, int runAtHour, int runAtMinute) =>
        nowLocal.TimeOfDay >= new TimeSpan(runAtHour, runAtMinute, 0);

    internal static TimeSpan GetNextDelay(TimeZoneInfo timeZone, int runAtHour, int runAtMinute)
    {
        var nowUtc = DateTimeOffset.UtcNow;
        var nowLocal = TimeZoneInfo.ConvertTime(nowUtc, timeZone);
        var nextLocal = new DateTimeOffset(nowLocal.Year, nowLocal.Month, nowLocal.Day, runAtHour, runAtMinute, 0, nowLocal.Offset);
        if (nextLocal <= nowLocal)
        {
            nextLocal = nextLocal.AddDays(1);
        }

        var delay = nextLocal.ToUniversalTime() - nowUtc;
        return delay <= TimeSpan.Zero ? TimeSpan.FromMinutes(1) : delay;
    }

    private static TimeSpan Min(TimeSpan a, TimeSpan b) => a < b ? a : b;

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
            return TimeZoneInfo.TryConvertIanaIdToWindowsId(timeZoneId, out var windowsId)
                ? TimeZoneInfo.FindSystemTimeZoneById(windowsId)
                : TimeZoneInfo.Utc;
        }
    }
}
