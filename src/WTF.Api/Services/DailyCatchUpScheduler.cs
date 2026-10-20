namespace WTF.Api.Services;

/// <summary>
/// Runs a job once a day. The app is hosted where it goes cold, so a plain "sleep until 02:00" would be lost whenever
/// the process is recycled. Instead every pass asks "is today's run due?" using the last run saved in storage: starting
/// the app after the run time catches up at once, and a wake-up that oversleeps still runs. Each pass is cheap (one
/// small read) and a failed run is retried a few times, then left for the next pass.
/// </summary>
public abstract class DailyCatchUpScheduler(IServiceScopeFactory scopeFactory, ILogger logger) : BackgroundService
{
    // Wake up at least this often, so a suspended host or a clock change cannot push the run a whole day late.
    private static readonly TimeSpan MaxSleep = TimeSpan.FromMinutes(30);

    protected abstract string JobName { get; }
    protected abstract bool IsEnabled { get; }
    protected abstract string TimeZoneId { get; }
    protected abstract int RunAtHour { get; }
    protected abstract int RunAtMinute { get; }
    protected abstract int RetryCount { get; }
    protected abstract int RetryDelayMinutes { get; }

    /// <summary>When the job last ran (saved by the job itself), or null if it never has.</summary>
    protected abstract Task<DateTimeOffset?> GetLastRunUtcAsync(IServiceProvider services, CancellationToken cancellationToken);

    protected abstract Task RunJobAsync(IServiceProvider services, CancellationToken cancellationToken);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!IsEnabled)
        {
            logger.LogInformation("{Job} scheduler is disabled.", JobName);
            return;
        }

        var timeZone = ResolveTimeZone(TimeZoneId);
        var failures = 0;
        while (!stoppingToken.IsCancellationRequested)
        {
            TimeSpan wait;
            try
            {
                await RunIfDueAsync(timeZone, stoppingToken);
                failures = 0;
                wait = Min(GetNextDelay(timeZone, RunAtHour, RunAtMinute), MaxSleep);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                failures++;
                logger.LogError(ex, "{Job} failed (attempt {Attempt}).", JobName, failures);

                // A few quick retries, then give up until the next scheduled run (the next pass sees it is still due).
                if (failures <= RetryCount)
                {
                    wait = TimeSpan.FromMinutes(Math.Max(1, RetryDelayMinutes));
                }
                else
                {
                    failures = 0;
                    wait = Min(GetNextDelay(timeZone, RunAtHour, RunAtMinute), MaxSleep);
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

        logger.LogInformation("{Job} scheduler is stopping.", JobName);
    }

    private async Task RunIfDueAsync(TimeZoneInfo timeZone, CancellationToken stoppingToken)
    {
        var nowLocal = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, timeZone);
        if (!IsPastRunTime(nowLocal, RunAtHour, RunAtMinute))
        {
            return;
        }

        using var scope = scopeFactory.CreateScope();
        var last = await GetLastRunUtcAsync(scope.ServiceProvider, stoppingToken);
        if (last is not null && TimeZoneInfo.ConvertTime(last.Value, timeZone).Date == nowLocal.Date)
        {
            return;
        }

        logger.LogInformation("{Job} is due; running now.", JobName);
        await RunJobAsync(scope.ServiceProvider, stoppingToken);
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

    internal static TimeZoneInfo ResolveTimeZone(string timeZoneId)
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
