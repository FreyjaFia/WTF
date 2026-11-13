using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System.Text.Json;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Features.Notifications;
using WTF.Api.Services;
using WTF.Calculations.Orders;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

public sealed class HeldOrderRemindersOptions
{
    public const string SectionName = "HeldOrderReminders";

    public bool Enabled { get; set; } = true;

    public string TimeZoneId { get; set; } = "Asia/Manila";

    public int RunAtHour { get; set; } = 8;

    public int RunAtMinute { get; set; } = 30;

    public bool DryRun { get; set; }

    public int RetryCount { get; set; } = 3;

    public int RetryDelayMinutes { get; set; } = 15;
}

public sealed record HeldOrderReminderResult(DateTimeOffset RanAtUtc, bool DryRun, int AgedOrders, decimal AgedAmount, int Notified, bool Skipped);

public interface IHeldOrderReminderService
{
    Task<HeldOrderReminderResult> RunAsync(CancellationToken cancellationToken);

    Task<HeldOrderReminderResult?> GetLastRunAsync(CancellationToken cancellationToken);
}

// Once a day, the people who may decide on held orders hear how many have waited past the aged-after days and what they are
// worth. Yesterday's unread reminder is marked read first, so the list holds one live reminder, not a pile.
public sealed class HeldOrderReminderService(
    WTFDbContext db,
    INotificationService notifications,
    IReportFileStorage reportStorage,
    IOptions<HeldOrderRemindersOptions> options) : IHeldOrderReminderService
{
    public const string StatePath = "system/held-order-reminders.json";

    private static readonly string[] DeciderRoles = SystemRolePermissions.RolesWith("orders.override");

    public async Task<HeldOrderReminderResult> RunAsync(CancellationToken cancellationToken)
    {
        var settings = options.Value;
        var nowUtc = DateTimeOffset.UtcNow;
        if (!settings.Enabled)
        {
            return new HeldOrderReminderResult(nowUtc, settings.DryRun, 0, 0m, 0, true);
        }

        var agedAfterDays = await HeldOrderAging.AgedAfterDaysAsync(db, cancellationToken);
        var held = HeldOrderRules.Summarize(await HeldOrderFigures.LoadAsync(db, null, null, null, cancellationToken), nowUtc.UtcDateTime, agedAfterDays);

        var notified = 0;
        if (held.AgedCount > 0)
        {
            var recipients = await db.Users.AsNoTracking()
                .Where(u => u.IsActive && DeciderRoles.Contains(u.Role.Name))
                .Select(u => u.Id)
                .ToListAsync(cancellationToken);

            if (!settings.DryRun && recipients.Count > 0)
            {
                var yesterdays = await db.Notifications
                    .Where(n => n.Kind == NotificationKinds.HeldOrderReview && n.ReadAt == null && recipients.Contains(n.UserId))
                    .ToListAsync(cancellationToken);
                foreach (var old in yesterdays)
                {
                    old.ReadAt = nowUtc.UtcDateTime;
                }

                await db.SaveChangesAsync(cancellationToken);

                await notifications.NotifyAsync(
                    recipients,
                    new NotificationMessage(
                        NotificationKinds.HeldOrderReview,
                        NotificationSeverity.Warning,
                        "Offline orders waiting for review",
                        HeldOrderRules.AgedInsightText(held.AgedCount, held.AgedAmount, agedAfterDays),
                        "/orders/held?agedOnly=true"),
                    cancellationToken);
            }

            notified = recipients.Count;
        }

        var result = new HeldOrderReminderResult(nowUtc, settings.DryRun, held.AgedCount, held.AgedAmount, notified, false);
        await reportStorage.SaveAsync(StatePath, JsonSerializer.SerializeToUtf8Bytes(result), "application/json", nowUtc, cancellationToken);
        return result;
    }

    public async Task<HeldOrderReminderResult?> GetLastRunAsync(CancellationToken cancellationToken)
    {
        var bytes = await reportStorage.ReadAllBytesAsync(StatePath, cancellationToken);
        if (bytes is null)
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<HeldOrderReminderResult>(bytes);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

public sealed class HeldOrderReminderScheduler(
    IServiceScopeFactory scopeFactory,
    IOptions<HeldOrderRemindersOptions> options,
    ILogger<HeldOrderReminderScheduler> logger) : DailyCatchUpScheduler(scopeFactory, logger)
{
    private HeldOrderRemindersOptions Settings => options.Value;

    protected override string JobName => "Held order reminders";
    protected override bool IsEnabled => Settings.Enabled;
    protected override string TimeZoneId => Settings.TimeZoneId;
    protected override int RunAtHour => Settings.RunAtHour;
    protected override int RunAtMinute => Settings.RunAtMinute;
    protected override int RetryCount => Settings.RetryCount;
    protected override int RetryDelayMinutes => Settings.RetryDelayMinutes;

    protected override async Task<DateTimeOffset?> GetLastRunUtcAsync(IServiceProvider services, CancellationToken cancellationToken) =>
        (await services.GetRequiredService<IHeldOrderReminderService>().GetLastRunAsync(cancellationToken))?.RanAtUtc;

    protected override Task RunJobAsync(IServiceProvider services, CancellationToken cancellationToken) =>
        services.GetRequiredService<IHeldOrderReminderService>().RunAsync(cancellationToken);
}
