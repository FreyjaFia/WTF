using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Notifications;
using WTF.Calculations.Inventory;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory;

public interface IStockAlertService
{
    Task EvaluateAsync(IEnumerable<Guid> itemIds, CancellationToken cancellationToken);
}

public class StockAlertService(WTFDbContext db, INotificationService notifications) : IStockAlertService
{
    private static readonly string[] DefaultRecipientRoles = [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.StockManager];

    // Looks at each item's level after a change and tells the right people once when it got worse. The alert state moves
    // with one guarded UPDATE, so two registers that cross the level together alert once.
    public async Task EvaluateAsync(IEnumerable<Guid> itemIds, CancellationToken cancellationToken)
    {
        foreach (var itemId in itemIds.Distinct())
        {
            // Every change moves what the stock screens show, alert or not.
            await notifications.StockChangedAsync(itemId, cancellationToken);

            var item = await db.Items.AsNoTracking().FirstOrDefaultAsync(i => i.Id == itemId, cancellationToken);
            if (item is null || !item.IsActive)
            {
                continue;
            }

            var current = StockRules.StatusFor(item.CurrentQuantity, item.WarningQuantity, item.CriticalQuantity);
            var decision = StockAlertRules.Decide((StockStatus)item.LastAlertStatus, current);
            if ((byte)decision.Remember == item.LastAlertStatus)
            {
                continue;
            }

            var owns = await TryMoveStateAsync(item, (byte)decision.Remember, decision.Notify, cancellationToken);
            if (!decision.Notify || !owns)
            {
                continue;
            }

            await NotifyAsync(item, current, cancellationToken);
        }
    }

    private async Task<bool> TryMoveStateAsync(Item item, byte newStatus, bool mustBeHigher, CancellationToken cancellationToken)
    {
        if (!db.Database.IsRelational())
        {
            var tracked = await db.Items.FirstAsync(i => i.Id == item.Id, cancellationToken);
            if (mustBeHigher && tracked.LastAlertStatus >= newStatus)
            {
                return false;
            }

            tracked.LastAlertStatus = newStatus;
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }

        var rows = mustBeHigher
            ? await db.Database.ExecuteSqlInterpolatedAsync(
                $"UPDATE dbo.Items SET LastAlertStatus = {newStatus} WHERE Id = {item.Id} AND LastAlertStatus < {newStatus}",
                cancellationToken)
            : await db.Database.ExecuteSqlInterpolatedAsync(
                $"UPDATE dbo.Items SET LastAlertStatus = {newStatus} WHERE Id = {item.Id} AND LastAlertStatus <> {newStatus}",
                cancellationToken);

        return rows > 0;
    }

    private async Task NotifyAsync(Item item, StockStatus status, CancellationToken cancellationToken)
    {
        var recipients = await ResolveRecipientsAsync(db, item.Id, cancellationToken);
        if (recipients.Count == 0)
        {
            return;
        }

        var (title, body) = StockAlertMessages.For(item, status);
        await notifications.NotifyAsync(recipients, StockAlertMessages.Message(item, status, title, body), cancellationToken);
    }

    internal static async Task<List<Guid>> ResolveRecipientsAsync(WTFDbContext db, Guid itemId, CancellationToken cancellationToken)
    {
        var chosen = await db.ItemAlertRecipients
            .AsNoTracking()
            .Where(r => r.ItemId == itemId && r.IsActive && r.User.IsActive)
            .Select(r => r.UserId)
            .ToListAsync(cancellationToken);
        if (chosen.Count > 0)
        {
            return chosen;
        }

        return await db.Users
            .AsNoTracking()
            .Where(u => u.IsActive && DefaultRecipientRoles.Contains(u.Role.Name))
            .Select(u => u.Id)
            .ToListAsync(cancellationToken);
    }
}

public static class StockAlertMessages
{
    public static (string Title, string Body) For(Item item, StockStatus status)
    {
        var unit = InventoryUnitLabels.Abbreviate(item.UnitName);
        var left = $"{Format(item.CurrentQuantity)} {unit}";

        return status switch
        {
            StockStatus.Warning => ($"Low stock: {item.Name}", $"{left} left. The warning level is {Format(item.WarningQuantity ?? 0)} {unit}."),
            StockStatus.Critical => ($"Critically low: {item.Name}", $"{left} left. The critical level is {Format(item.CriticalQuantity ?? 0)} {unit}."),
            _ when item.CurrentQuantity < 0 => ($"Below zero: {item.Name}", $"{left}. Count it and correct the stock."),
            _ => ($"Out of stock: {item.Name}", "None left.")
        };
    }

    public static NotificationMessage Message(Item item, StockStatus status, string title, string body) =>
        new(
            NotificationKinds.StockAlert,
            status == StockStatus.Warning ? NotificationSeverity.Warning : NotificationSeverity.Critical,
            title,
            body,
            $"/inventory/items/details/{item.Id}",
            item.Id,
            $"{{\"status\":{(int)status},\"quantity\":{item.CurrentQuantity.ToString(System.Globalization.CultureInfo.InvariantCulture)}}}");

    public static (string Title, string Body) Reminder(Item item, StockStatus status, int day)
    {
        var (_, body) = For(item, status);
        var title = status switch
        {
            StockStatus.Warning or StockStatus.Critical => $"Still low: {item.Name}",
            _ when item.CurrentQuantity < 0 => $"Still below zero: {item.Name}",
            _ => $"Still out of stock: {item.Name}"
        };

        return (title, $"{body} Day {day}.");
    }

    private static string Format(decimal quantity) => quantity.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture);
}

public static class InventoryUnitLabels
{
    private static readonly Dictionary<string, string> Abbreviations = new(StringComparer.OrdinalIgnoreCase)
    {
        ["piece"] = "pc",
        ["bottle"] = "btl",
        ["carton"] = "ctn",
        ["sleeve"] = "slv",
        ["liter"] = "L",
        ["milliliter"] = "ml",
        ["kilogram"] = "kg",
        ["gram"] = "g"
    };

    public static string Abbreviate(string unitName) =>
        Abbreviations.TryGetValue(unitName, out var abbreviation) ? abbreviation : unitName;
}
