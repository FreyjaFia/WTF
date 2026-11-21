using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Notifications;
using WTF.Calculations.Inventory;
using WTF.Calculations.Subscriptions;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory;

public interface IStockAlertService
{
    Task EvaluateAsync(IEnumerable<Guid> itemIds, Guid branchId, CancellationToken cancellationToken);

    // A change to the item itself (levels, restore, delete) can move it in every branch that holds it.
    Task EvaluateEverywhereAsync(IEnumerable<Guid> itemIds, CancellationToken cancellationToken);
}

public class StockAlertService(WTFDbContext db, INotificationService notifications, ITenantFeatures tenantFeatures) : IStockAlertService
{
    private static readonly string[] DefaultRecipientRoles = SystemRolePermissions.RolesWith("stock.write");

    // Looks at each item's level in one branch after a change and tells the right people of that branch once when it got
    // worse. The alert state moves with one guarded UPDATE, so two registers that cross the level together alert once.
    public async Task EvaluateAsync(IEnumerable<Guid> itemIds, Guid branchId, CancellationToken cancellationToken)
    {
        if (!await tenantFeatures.HasFeatureAsync(db, PlanFeatures.Inventory, cancellationToken))
        {
            return;
        }

        var branchLabel = await StockBranchLabel.ForAsync(db, branchId, cancellationToken);

        foreach (var itemId in itemIds.Distinct())
        {
            // Every change moves what the stock screens show, alert or not.
            await notifications.StockChangedAsync(itemId, cancellationToken);

            var item = await db.Items.AsNoTracking().FirstOrDefaultAsync(i => i.Id == itemId, cancellationToken);
            if (item is null || !item.IsActive)
            {
                continue;
            }

            var stock = await db.ItemBranchStocks.AsNoTracking()
                .FirstOrDefaultAsync(s => s.ItemId == itemId && s.BranchId == branchId, cancellationToken);
            if (stock is null)
            {
                continue;
            }

            var levels = BranchItemSettings.For(item, stock);
            var current = StockRules.StatusFor(stock.CurrentQuantity, levels.WarningQuantity, levels.CriticalQuantity);
            var decision = StockAlertRules.Decide((StockStatus)stock.LastAlertStatus, current);
            if ((byte)decision.Remember == stock.LastAlertStatus)
            {
                continue;
            }

            var owns = await TryMoveStateAsync(stock, (byte)decision.Remember, decision.Notify, cancellationToken);
            if (!decision.Notify || !owns)
            {
                continue;
            }

            await NotifyAsync(item, stock.CurrentQuantity, branchId, branchLabel, current, levels, cancellationToken);
        }
    }

    public async Task EvaluateEverywhereAsync(IEnumerable<Guid> itemIds, CancellationToken cancellationToken)
    {
        var ids = itemIds.Distinct().ToList();
        var pairs = await db.ItemBranchStocks
            .IgnoreQueryFilters([WTFDbContext.BranchFilterName])
            .AsNoTracking()
            .Where(s => ids.Contains(s.ItemId))
            .Select(s => s.BranchId)
            .Distinct()
            .ToListAsync(cancellationToken);

        foreach (var branchId in pairs)
        {
            await EvaluateAsync(ids, branchId, cancellationToken);
        }
    }

    private async Task<bool> TryMoveStateAsync(ItemBranchStock stock, byte newStatus, bool mustBeHigher, CancellationToken cancellationToken)
    {
        if (!db.Database.IsRelational())
        {
            var tracked = await db.ItemBranchStocks.FirstAsync(s => s.Id == stock.Id, cancellationToken);
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
                $"UPDATE dbo.ItemBranchStocks SET LastAlertStatus = {newStatus} WHERE Id = {stock.Id} AND LastAlertStatus < {newStatus} AND ({db.TenantFilterEnabled} = 0 OR TenantId = {db.StampTenantId})",
                cancellationToken)
            : await db.Database.ExecuteSqlInterpolatedAsync(
                $"UPDATE dbo.ItemBranchStocks SET LastAlertStatus = {newStatus} WHERE Id = {stock.Id} AND LastAlertStatus <> {newStatus} AND ({db.TenantFilterEnabled} = 0 OR TenantId = {db.StampTenantId})",
                cancellationToken);

        return rows > 0;
    }

    private async Task NotifyAsync(Item item, decimal quantity, Guid branchId, string? branchLabel, StockStatus status, BranchItemSettings levels, CancellationToken cancellationToken)
    {
        var recipients = await ResolveRecipientsAsync(db, item.Id, branchId, cancellationToken);
        if (recipients.Count == 0)
        {
            return;
        }

        var (title, body) = StockAlertMessages.For(item, quantity, status, branchLabel, levels);
        await notifications.NotifyAsync(recipients, StockAlertMessages.Message(item, quantity, branchId, status, title, body), cancellationToken);
    }

    // Only people who may work in that branch hear about it.
    internal static async Task<List<Guid>> ResolveRecipientsAsync(WTFDbContext db, Guid itemId, Guid branchId, CancellationToken cancellationToken)
    {
        var chosen = await db.ItemAlertRecipients
            .AsNoTracking()
            .Where(r => r.ItemId == itemId && r.IsActive && r.User.IsActive
                        && (r.User.BranchScope == 0 || r.User.UserBranches.Any(b => b.BranchId == branchId)))
            .Select(r => r.UserId)
            .ToListAsync(cancellationToken);
        if (chosen.Count > 0)
        {
            return chosen;
        }

        return await db.Users
            .AsNoTracking()
            .Where(u => u.IsActive && DefaultRecipientRoles.Contains(u.Role.Name)
                        && (u.BranchScope == 0 || u.UserBranches.Any(b => b.BranchId == branchId)))
            .Select(u => u.Id)
            .ToListAsync(cancellationToken);
    }
}

public static class StockBranchLabel
{
    // The branch name for texts, only when the shop runs more than one branch (a one-branch shop reads as before).
    public static async Task<string?> ForAsync(WTFDbContext db, Guid branchId, CancellationToken cancellationToken)
    {
        var branches = await db.Branches
            .IgnoreQueryFilters([WTFDbContext.BranchFilterName])
            .AsNoTracking()
            .Where(b => b.IsActive || b.Id == branchId)
            .Select(b => new { b.Id, b.Name })
            .ToListAsync(cancellationToken);

        return branches.Count > 1 ? branches.FirstOrDefault(b => b.Id == branchId)?.Name : null;
    }
}

public static class StockAlertKey
{
    // One alert row per item and branch: the same item can be low in one branch and fine in another.
    public static Guid For(Guid itemId, Guid branchId)
    {
        Span<byte> bytes = stackalloc byte[16];
        var a = itemId.ToByteArray();
        var b = branchId.ToByteArray();
        for (var i = 0; i < 16; i++)
        {
            bytes[i] = (byte)(a[i] ^ b[(i + 7) % 16] ^ (byte)(i * 31 + 5));
        }

        return new Guid(bytes);
    }
}

public static class StockAlertMessages
{
    public static (string Title, string Body) For(Item item, decimal quantity, StockStatus status, string? branchName = null, BranchItemSettings? levels = null)
    {
        var unit = InventoryUnitLabels.Abbreviate(item.UnitName);
        var left = $"{Format(quantity)} {unit}";
        var where = branchName is null ? string.Empty : $" ({branchName})";

        return status switch
        {
            StockStatus.Warning => ($"Low stock: {item.Name}{where}", $"{left} left. The warning level is {Format(levels?.WarningQuantity ?? item.WarningQuantity ?? 0)} {unit}."),
            StockStatus.Critical => ($"Critically low: {item.Name}{where}", $"{left} left. The critical level is {Format(levels?.CriticalQuantity ?? item.CriticalQuantity ?? 0)} {unit}."),
            _ when quantity < 0 => ($"Below zero: {item.Name}{where}", $"{left}. Count it and correct the stock."),
            _ => ($"Out of stock: {item.Name}{where}", "None left.")
        };
    }

    public static NotificationMessage Message(Item item, decimal quantity, Guid branchId, StockStatus status, string title, string body) =>
        new(
            NotificationKinds.StockAlert,
            status == StockStatus.Warning ? NotificationSeverity.Warning : NotificationSeverity.Critical,
            title,
            body,
            $"/inventory/items/details/{item.Id}",
            StockAlertKey.For(item.Id, branchId),
            $"{{\"status\":{(int)status},\"quantity\":{quantity.ToString(System.Globalization.CultureInfo.InvariantCulture)},\"branchId\":\"{branchId}\"}}");

    public static (string Title, string Body) Reminder(Item item, decimal quantity, StockStatus status, int day, string? branchName = null, BranchItemSettings? levels = null)
    {
        var (_, body) = For(item, quantity, status, branchName, levels);
        var where = branchName is null ? string.Empty : $" ({branchName})";
        var title = status switch
        {
            StockStatus.Warning or StockStatus.Critical => $"Still low: {item.Name}{where}",
            _ when quantity < 0 => $"Still below zero: {item.Name}{where}",
            _ => $"Still out of stock: {item.Name}{where}"
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
