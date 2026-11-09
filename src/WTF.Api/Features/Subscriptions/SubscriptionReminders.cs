using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System.Text.Json;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Features.Notifications;
using WTF.Api.Services;
using WTF.Calculations.Subscriptions;
using WTF.Domain.Data;
using WTF.Domain.Tenancy;

namespace WTF.Api.Features.Subscriptions;

public sealed record SubscriptionReminderResult(DateTimeOffset RanAtUtc, bool DryRun, int Reminders, bool Skipped);

public interface ISubscriptionReminderService
{
    Task<SubscriptionReminderResult> RunAsync(CancellationToken cancellationToken);

    Task<SubscriptionReminderResult?> GetLastRunAsync(CancellationToken cancellationToken);
}

// Tells the shop's owners (Owners and Admins) 7, 3 and 1 days before the paid time ends and every day of the grace period.
// Runs once a day for each shop; nothing is sent twice on the same day.
public sealed class SubscriptionReminderService(
    WTFDbContext db,
    ICurrentTenant currentTenant,
    INotificationService notifications,
    IReportFileStorage reportStorage,
    IOptions<SubscriptionRemindersOptions> options,
    TimeProvider clock,
    ILogger<SubscriptionReminderService> logger) : ISubscriptionReminderService
{
    public const string StatePath = "system/subscription-reminders.json";

    private static readonly int[] WarningDays = [SubscriptionRules.SoonDays, SubscriptionRules.LastDaysCount, 1];

    public async Task<SubscriptionReminderResult> RunAsync(CancellationToken cancellationToken)
    {
        var settings = options.Value;
        var nowUtc = clock.GetUtcNow();
        if (!settings.Enabled || currentTenant.StampTenantId is not { } tenantId)
        {
            return new SubscriptionReminderResult(nowUtc, settings.DryRun, 0, true);
        }

        var reminders = 0;
        var sub = await db.TenantSubscriptions.FirstOrDefaultAsync(s => s.TenantId == tenantId, cancellationToken);
        if (sub is not null && ReminderFor(sub.CurrentPeriodEnd, sub.GraceDays, nowUtc.UtcDateTime) is { } text
            && sub.ReminderSentOn != DateOnly.FromDateTime(nowUtc.UtcDateTime))
        {
            var billingRoles = SystemRolePermissions.RolesWith("subscription.billing");
            var owners = await db.Users.AsNoTracking()
                .Where(u => u.IsActive && billingRoles.Contains(u.Role.Name))
                .Select(u => u.Id)
                .ToListAsync(cancellationToken);

            if (owners.Count > 0 && !settings.DryRun)
            {
                await notifications.NotifyAsync(
                    owners,
                    new NotificationMessage(
                        NotificationKinds.Subscription,
                        text.Severity,
                        text.Title,
                        text.Body,
                        "/management/subscription",
                        tenantId),
                    cancellationToken);

                sub.ReminderSentOn = DateOnly.FromDateTime(nowUtc.UtcDateTime);
                await db.SaveChangesAsync(cancellationToken);
            }

            reminders = owners.Count;
        }

        logger.LogInformation("Subscription reminders {Mode}: {Reminders} for tenant {Tenant}.", settings.DryRun ? "(dry run) would send" : "sent", reminders, tenantId);

        var result = new SubscriptionReminderResult(nowUtc, settings.DryRun, reminders, false);
        await reportStorage.SaveAsync(StatePath, JsonSerializer.SerializeToUtf8Bytes(result), "application/json", nowUtc, cancellationToken);
        return result;
    }

    public async Task<SubscriptionReminderResult?> GetLastRunAsync(CancellationToken cancellationToken)
    {
        var bytes = await reportStorage.ReadAllBytesAsync(StatePath, cancellationToken);
        if (bytes is null)
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<SubscriptionReminderResult>(bytes);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public static (byte Severity, string Title, string Body)? ReminderFor(DateTime periodEnd, int graceDays, DateTime now)
    {
        switch (SubscriptionRules.WarningLevel(periodEnd, graceDays, now))
        {
            case SubscriptionWarning.Soon or SubscriptionWarning.LastDays:
                var days = SubscriptionRules.DaysLeft(periodEnd, now);
                return WarningDays.Contains(days)
                    ? (NotificationSeverity.Warning, "Subscription ends soon", $"Your subscription ends in {days} day{(days == 1 ? string.Empty : "s")} ({periodEnd:d MMM yyyy}). Contact support to renew.")
                    : null;

            case SubscriptionWarning.Grace:
                var until = SubscriptionRules.AccessUntil(periodEnd, graceDays);
                return (NotificationSeverity.Critical, "Subscription ended", $"Your subscription has ended. The app stops on {until:d MMM yyyy}. Contact support to renew.");

            default:
                return null;
        }
    }
}

public sealed class SubscriptionReminderScheduler(
    IServiceScopeFactory scopeFactory,
    IOptions<SubscriptionRemindersOptions> options,
    ILogger<SubscriptionReminderScheduler> logger) : DailyCatchUpScheduler(scopeFactory, logger)
{
    private SubscriptionRemindersOptions Settings => options.Value;

    protected override string JobName => "Subscription reminders";
    protected override bool IsEnabled => Settings.Enabled;
    protected override string TimeZoneId => Settings.TimeZoneId;
    protected override int RunAtHour => Settings.RunAtHour;
    protected override int RunAtMinute => Settings.RunAtMinute;
    protected override int RetryCount => Settings.RetryCount;
    protected override int RetryDelayMinutes => Settings.RetryDelayMinutes;

    protected override async Task<DateTimeOffset?> GetLastRunUtcAsync(IServiceProvider services, CancellationToken cancellationToken) =>
        (await services.GetRequiredService<ISubscriptionReminderService>().GetLastRunAsync(cancellationToken))?.RanAtUtc;

    protected override Task RunJobAsync(IServiceProvider services, CancellationToken cancellationToken) =>
        services.GetRequiredService<ISubscriptionReminderService>().RunAsync(cancellationToken);
}
