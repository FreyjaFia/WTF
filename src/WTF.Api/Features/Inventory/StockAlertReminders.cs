using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System.Text.Json;
using WTF.Api.Services;
using WTF.Calculations.Inventory;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory;

public sealed class StockAlertRemindersOptions
{
    public const string SectionName = "StockAlertReminders";

    public bool Enabled { get; set; } = true;

    public string TimeZoneId { get; set; } = "Asia/Manila";

    public int RunAtHour { get; set; } = 8;

    public int RunAtMinute { get; set; } = 0;

    public bool DryRun { get; set; } = true;

    public int RetryCount { get; set; } = 3;

    public int RetryDelayMinutes { get; set; } = 15;
}

public sealed record StockReminderResult(
    DateTimeOffset RanAtUtc,
    bool DryRun,
    int LowItems,
    int Reminders,
    bool Skipped);

public interface IStockReminderService
{
    Task<StockReminderResult> RunAsync(CancellationToken cancellationToken);

    Task<StockReminderResult?> GetLastRunAsync(CancellationToken cancellationToken);
}

// Once a day, every item still at a warning, critical or empty level reminds the same people again until it is back to ok.
// A reminder lifts the person's existing alert for the item back to the top, unread, with the day count, so the list does
// not fill with copies. Only items that were alerted (LastAlertStatus above ok) are reminded, so a new item that was never
// stocked stays quiet.
public sealed class StockReminderService(
    WTFDbContext db,
    IPushNotificationService pushNotifications,
    IReportFileStorage reportStorage,
    IOptions<StockAlertRemindersOptions> options,
    ILogger<StockReminderService> logger) : IStockReminderService
{
    public const string StatePath = "system/stock-alert-reminders.json";

    public async Task<StockReminderResult> RunAsync(CancellationToken cancellationToken)
    {
        var settings = options.Value;
        var nowUtc = DateTimeOffset.UtcNow;
        if (!settings.Enabled)
        {
            return new StockReminderResult(nowUtc, settings.DryRun, 0, 0, true);
        }

        var timeZone = DailyCatchUpScheduler.ResolveTimeZone(settings.TimeZoneId);
        var localNow = TimeZoneInfo.ConvertTime(nowUtc, timeZone);
        var dayStartUtc = new DateTimeOffset(localNow.Year, localNow.Month, localNow.Day, 0, 0, 0, localNow.Offset).UtcDateTime;

        var items = await db.Items
            .AsNoTracking()
            .Where(i => i.IsActive && i.LastAlertStatus > 0)
            .ToListAsync(cancellationToken);

        var lowItems = 0;
        var reminders = 0;
        foreach (var item in items)
        {
            var status = StockRules.StatusFor(item.CurrentQuantity, item.WarningQuantity, item.CriticalQuantity);
            if (status == StockStatus.Ok)
            {
                continue;
            }

            lowItems++;
            reminders += await RemindAsync(item, status, dayStartUtc, settings.DryRun, nowUtc.UtcDateTime, cancellationToken);
        }

        logger.LogInformation(
            "Stock reminders {Mode}: {Reminders} reminders for {Items} low items.",
            settings.DryRun ? "(dry run) would send" : "sent", reminders, lowItems);

        var result = new StockReminderResult(nowUtc, settings.DryRun, lowItems, reminders, false);
        await reportStorage.SaveAsync(StatePath, JsonSerializer.SerializeToUtf8Bytes(result), "application/json", nowUtc, cancellationToken);
        return result;
    }

    public async Task<StockReminderResult?> GetLastRunAsync(CancellationToken cancellationToken)
    {
        var bytes = await reportStorage.ReadAllBytesAsync(StatePath, cancellationToken);
        if (bytes is null)
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<StockReminderResult>(bytes);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private async Task<int> RemindAsync(Item item, StockStatus status, DateTime dayStartUtc, bool dryRun, DateTime now, CancellationToken cancellationToken)
    {
        var recipients = await StockAlertService.ResolveRecipientsAsync(db, item.Id, cancellationToken);
        var pushByText = new Dictionary<(string Title, string Body), List<Guid>>();
        var sent = 0;

        foreach (var userId in recipients)
        {
            var latest = await db.StockNotifications
                .Where(n => n.ItemId == item.Id && n.UserId == userId)
                .OrderByDescending(n => n.CreatedAt)
                .FirstOrDefaultAsync(cancellationToken);

            // An alert (or reminder) made today already did today's job.
            if (latest is not null && latest.CreatedAt >= dayStartUtc)
            {
                continue;
            }

            if (dryRun)
            {
                sent++;
                continue;
            }

            var (title, body) = latest is null
                ? StockAlertMessages.For(item, status)
                : StockAlertMessages.Reminder(item, status, latest.ReminderCount + 2);

            if (latest is null)
            {
                db.StockNotifications.Add(new StockNotification
                {
                    UserId = userId,
                    ItemId = item.Id,
                    Status = (byte)status,
                    Quantity = item.CurrentQuantity,
                    Title = title,
                    Body = body,
                    CreatedAt = now,
                    LastRemindedAt = now
                });
                await db.SaveChangesAsync(cancellationToken);
            }
            else if (!await LiftAsync(latest, status, item.CurrentQuantity, title, body, dayStartUtc, now, cancellationToken))
            {
                continue;
            }

            sent++;
            if (!pushByText.TryGetValue((title, body), out var group))
            {
                group = [];
                pushByText[(title, body)] = group;
            }

            group.Add(userId);
        }

        foreach (var ((title, body), users) in pushByText)
        {
            try
            {
                await pushNotifications.SendStockAlertAsync(users, title, body, item.Id, cancellationToken);
            }
            catch (Exception)
            {
                // The saved list is the record; a failed push never stops the other reminders.
            }
        }

        return sent;
    }

    // One guarded UPDATE, so two runs in the same moment lift the row once.
    private async Task<bool> LiftAsync(
        StockNotification row,
        StockStatus status,
        decimal quantity,
        string title,
        string body,
        DateTime dayStartUtc,
        DateTime now,
        CancellationToken cancellationToken)
    {
        if (!db.Database.IsRelational())
        {
            row.Status = (byte)status;
            row.Quantity = quantity;
            row.Title = title;
            row.Body = body;
            row.CreatedAt = now;
            row.ReadAt = null;
            row.ReminderCount++;
            row.LastRemindedAt = now;
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }

        var statusValue = (byte)status;
        var rows = await db.Database.ExecuteSqlInterpolatedAsync(
            $@"UPDATE dbo.StockNotifications
               SET Status = {statusValue}, Quantity = {quantity}, Title = {title}, Body = {body},
                   CreatedAt = {now}, ReadAt = NULL, ReminderCount = ReminderCount + 1, LastRemindedAt = {now}
               WHERE Id = {row.Id} AND CreatedAt < {dayStartUtc}",
            cancellationToken);

        return rows > 0;
    }
}

public sealed class StockReminderScheduler(
    IServiceScopeFactory scopeFactory,
    IOptions<StockAlertRemindersOptions> options,
    ILogger<StockReminderScheduler> logger) : DailyCatchUpScheduler(scopeFactory, logger)
{
    private StockAlertRemindersOptions Settings => options.Value;

    protected override string JobName => "Stock alert reminders";
    protected override bool IsEnabled => Settings.Enabled;
    protected override string TimeZoneId => Settings.TimeZoneId;
    protected override int RunAtHour => Settings.RunAtHour;
    protected override int RunAtMinute => Settings.RunAtMinute;
    protected override int RetryCount => Settings.RetryCount;
    protected override int RetryDelayMinutes => Settings.RetryDelayMinutes;

    protected override async Task<DateTimeOffset?> GetLastRunUtcAsync(IServiceProvider services, CancellationToken cancellationToken) =>
        (await services.GetRequiredService<IStockReminderService>().GetLastRunAsync(cancellationToken))?.RanAtUtc;

    protected override Task RunJobAsync(IServiceProvider services, CancellationToken cancellationToken) =>
        services.GetRequiredService<IStockReminderService>().RunAsync(cancellationToken);
}
