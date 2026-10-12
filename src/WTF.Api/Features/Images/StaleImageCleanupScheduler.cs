using Microsoft.Extensions.Options;
using WTF.Api.Services;

namespace WTF.Api.Features.Images;

/// <summary>Runs the stale image cleanup once a day, catching up after a cold start (see <see cref="DailyCatchUpScheduler"/>).</summary>
public sealed class StaleImageCleanupScheduler(
    IServiceScopeFactory scopeFactory,
    IOptions<StaleImageCleanupOptions> options,
    ILogger<StaleImageCleanupScheduler> logger) : DailyCatchUpScheduler(scopeFactory, logger)
{
    private StaleImageCleanupOptions Settings => options.Value;

    protected override string JobName => "Stale image cleanup";
    protected override bool IsEnabled => Settings.Enabled && Settings.RetentionDays > 0;
    protected override string TimeZoneId => Settings.TimeZoneId;
    protected override int RunAtHour => Settings.RunAtHour;
    protected override int RunAtMinute => Settings.RunAtMinute;
    protected override int RetryCount => Settings.RetryCount;
    protected override int RetryDelayMinutes => Settings.RetryDelayMinutes;

    protected override async Task<DateTimeOffset?> GetLastRunUtcAsync(IServiceProvider services, CancellationToken cancellationToken) =>
        (await services.GetRequiredService<IStaleImageCleanupService>().GetLastRunAsync(cancellationToken))?.RanAtUtc;

    protected override Task RunJobAsync(IServiceProvider services, CancellationToken cancellationToken) =>
        services.GetRequiredService<IStaleImageCleanupService>().RunAsync(cancellationToken);
}
