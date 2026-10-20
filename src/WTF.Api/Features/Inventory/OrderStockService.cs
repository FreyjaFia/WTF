using Microsoft.EntityFrameworkCore;
using System.Globalization;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Services;
using WTF.Calculations.Inventory;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory;

public record StockDeductionOptions(bool BlockWhenShort = true, bool IsCorrection = false);

public record StockDeductionResult(List<string> Warnings)
{
    public static StockDeductionResult None => new([]);
}

public interface IOrderStockService
{
    Task<StockDeductionResult> DeductForOrderAsync(
        Guid orderId, Guid userId, StockDeductionOptions options, CancellationToken cancellationToken);

    Task RestoreForOrderAsync(
        Guid orderId, Guid userId, IReadOnlySet<Guid> notReturnedLineIds, CancellationToken cancellationToken);
}

public class OrderStockService(WTFDbContext db, IAuditService auditService, IStockAlertService stockAlerts) : IOrderStockService
{
    private const string NotResaleableNote = "Refunded, not resaleable";
    private const string BelowZeroNote = "Balance went below zero";

    public async Task<StockDeductionResult> DeductForOrderAsync(
        Guid orderId, Guid userId, StockDeductionOptions options, CancellationToken cancellationToken)
    {
        var lines = await LoadLinesAsync(orderId, cancellationToken);
        var productIds = lines.Select(line => line.ProductId).Distinct().ToList();

        var links = await db.ProductItemLinks
            .AsNoTracking()
            .Where(link => link.IsActive && link.Item.IsActive && productIds.Contains(link.ProductId))
            .Select(link => new StockLink(link.ProductId, link.ItemId, link.QuantityPerSale))
            .ToListAsync(cancellationToken);

        var required = StockRules.Requirements(lines, links);
        var taken = await LoadTakenAsync(orderId, cancellationToken);

        // A product still on the order whose link has since been switched off keeps what it already took.
        var productsOnOrder = productIds.ToHashSet();
        var requiredKeys = required.Select(r => (r.ItemId, r.ProductId)).ToHashSet();
        var kept = taken
            .Where(t => productsOnOrder.Contains(t.ProductId) && !requiredKeys.Contains((t.ItemId, t.ProductId)))
            .ToHashSet();
        var changes = StockRules.Reconcile(required, taken.Except(kept).ToList());

        if (changes.Count == 0 || (options.IsCorrection && taken.Count == 0 && await IsBeforeStockTrackingAsync(orderId, cancellationToken)))
        {
            return StockDeductionResult.None;
        }

        var items = await LoadItemsAsync(changes.Select(c => c.ItemId), cancellationToken);
        var warnings = new List<string>();
        var written = new List<object>();
        var now = DateTime.UtcNow;
        var tick = 0;

        foreach (var itemChanges in changes.GroupBy(c => c.ItemId).OrderBy(group => group.Key))
        {
            var item = items[itemChanges.Key];
            var net = itemChanges.Sum(c => c.Quantity);
            var applied = await StockBalance.ApplyAsync(db, item.Id, net, !options.BlockWhenShort, cancellationToken)
                ?? throw new InvalidOperationException(await ShortMessageAsync(item, -net, cancellationToken));

            var running = applied.Before;
            foreach (var change in itemChanges)
            {
                var after = running + change.Quantity;
                db.StockMovements.Add(new StockMovement
                {
                    ItemId = item.Id,
                    ProductId = change.ProductId,
                    OrderItemId = change.OrderLineId,
                    MovementType = change.Quantity < 0 ? StockMovementTypes.Sale : StockMovementTypes.SaleVoid,
                    QuantityDelta = change.Quantity,
                    QuantityBefore = running,
                    QuantityAfter = after,
                    UnitCost = item.CostPrice,
                    ReferenceType = StockMovementTypes.OrderReference,
                    ReferenceId = orderId,
                    Notes = after < 0 && change.Quantity < 0 ? BelowZeroNote : null,
                    CreatedAt = now.AddTicks(tick++),
                    CreatedBy = userId
                });
                written.Add(new { item.Name, change.ProductId, change.Quantity, Before = running, After = after });
                running = after;
            }

            if (net < 0)
            {
                var warning = WarningFor(item, applied.After);
                if (warning is not null)
                {
                    warnings.Add(warning);
                }
            }
        }

        await db.SaveChangesAsync(cancellationToken);
        await stockAlerts.EvaluateAsync(changes.Select(c => c.ItemId), cancellationToken);

        await auditService.LogAsync(
            AuditAction.OrderStockDeducted,
            AuditEntityType.Order,
            orderId.ToString(),
            newValues: new { Movements = written },
            userId: userId,
            cancellationToken: cancellationToken);

        return new StockDeductionResult(warnings);
    }

    public async Task RestoreForOrderAsync(
        Guid orderId, Guid userId, IReadOnlySet<Guid> notReturnedLineIds, CancellationToken cancellationToken)
    {
        var taken = await LoadTakenAsync(orderId, cancellationToken);
        if (taken.Count == 0)
        {
            return;
        }

        var weights = await LoadWeightsAsync(orderId, notReturnedLineIds, cancellationToken);
        var items = await LoadItemsAsync(taken.Select(t => t.ItemId), cancellationToken);
        var written = new List<object>();
        var now = DateTime.UtcNow;
        var tick = 0;

        foreach (var itemTaken in taken.GroupBy(t => t.ItemId).OrderBy(group => group.Key))
        {
            var item = items[itemTaken.Key];
            var rows = new List<(StockChange Change, string Type, string? Note)>();
            foreach (var change in itemTaken)
            {
                weights.TryGetValue(change.ProductId, out var weight);
                var returned = weight.Total <= 0m
                    ? change.Quantity
                    : StockRules.ReturnedShare(change.Quantity, weight.Returned, weight.Total);
                var notReturned = StockRules.Round(change.Quantity - returned);

                rows.Add((change with { Quantity = change.Quantity }, StockMovementTypes.SaleVoid, null));
                if (notReturned > 0m)
                {
                    rows.Add((change with { Quantity = -notReturned }, StockMovementTypes.Waste, NotResaleableNote));
                }
            }

            var net = rows.Sum(row => row.Change.Quantity);
            var applied = await StockBalance.ApplyAsync(db, item.Id, net, true, cancellationToken)
                ?? throw new InvalidOperationException($"The item {item.Name} was not found.");

            var running = applied.Before;
            foreach (var (change, type, note) in rows)
            {
                var after = running + change.Quantity;
                db.StockMovements.Add(new StockMovement
                {
                    ItemId = item.Id,
                    ProductId = change.ProductId,
                    OrderItemId = change.OrderLineId,
                    MovementType = type,
                    QuantityDelta = change.Quantity,
                    QuantityBefore = running,
                    QuantityAfter = after,
                    UnitCost = item.CostPrice,
                    ReferenceType = StockMovementTypes.OrderReference,
                    ReferenceId = orderId,
                    Notes = note,
                    CreatedAt = now.AddTicks(tick++),
                    CreatedBy = userId
                });
                written.Add(new { item.Name, change.ProductId, type, change.Quantity, Before = running, After = after });
                running = after;
            }
        }

        await db.SaveChangesAsync(cancellationToken);
        await stockAlerts.EvaluateAsync(taken.Select(t => t.ItemId), cancellationToken);

        await auditService.LogAsync(
            AuditAction.OrderStockRestored,
            AuditEntityType.Order,
            orderId.ToString(),
            newValues: new { Movements = written },
            userId: userId,
            cancellationToken: cancellationToken);
    }

    private async Task<List<StockLine>> LoadLinesAsync(Guid orderId, CancellationToken cancellationToken)
    {
        return await db.OrderItems
            .AsNoTracking()
            .Where(oi => oi.OrderId == orderId)
            .Select(oi => new StockLine(oi.Id, oi.ParentOrderItemId, oi.ProductId, oi.Quantity))
            .ToListAsync(cancellationToken);
    }

    // What the order has taken so far, per item and product: sales count, restocks and corrections give back.
    private async Task<List<StockChange>> LoadTakenAsync(Guid orderId, CancellationToken cancellationToken)
    {
        var movements = await db.StockMovements
            .AsNoTracking()
            .Where(m => m.ReferenceType == StockMovementTypes.OrderReference
                        && m.ReferenceId == orderId
                        && m.ProductId != null
                        && (m.MovementType == StockMovementTypes.Sale || m.MovementType == StockMovementTypes.SaleVoid))
            .Select(m => new { m.ItemId, ProductId = m.ProductId!.Value, m.QuantityDelta })
            .ToListAsync(cancellationToken);

        return movements
            .GroupBy(m => (m.ItemId, m.ProductId))
            .Select(group => new StockChange(group.Key.ItemId, group.Key.ProductId, StockRules.Round(-group.Sum(m => m.QuantityDelta)), null))
            .Where(change => change.Quantity != 0m)
            .ToList();
    }

    // An order made before stock tracking started has no movements, so correcting it must not deduct it for the first time.
    private async Task<bool> IsBeforeStockTrackingAsync(Guid orderId, CancellationToken cancellationToken)
    {
        var createdAt = await db.Orders
            .AsNoTracking()
            .Where(o => o.Id == orderId)
            .Select(o => o.CreatedAt)
            .FirstAsync(cancellationToken);

        var firstSale = await db.StockMovements
            .AsNoTracking()
            .Where(m => m.MovementType == StockMovementTypes.Sale)
            .OrderBy(m => m.CreatedAt)
            .Select(m => (DateTime?)m.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);

        return firstSale is null || createdAt < firstSale;
    }

    private async Task<Dictionary<Guid, Item>> LoadItemsAsync(IEnumerable<Guid> itemIds, CancellationToken cancellationToken)
    {
        var ids = itemIds.Distinct().ToList();
        return await db.Items
            .AsNoTracking()
            .Where(item => ids.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, cancellationToken);
    }

    // Per product, how many units sit on lines that go back to the shelf (Returned) out of all units sold (Total).
    private async Task<Dictionary<Guid, (decimal Returned, decimal Total)>> LoadWeightsAsync(
        Guid orderId, IReadOnlySet<Guid> notReturnedLineIds, CancellationToken cancellationToken)
    {
        var lines = await LoadLinesAsync(orderId, cancellationToken);
        var lineById = lines.ToDictionary(line => line.LineId);
        var weights = new Dictionary<Guid, (decimal Returned, decimal Total)>();

        foreach (var line in lines)
        {
            var root = line.ParentLineId.HasValue && lineById.TryGetValue(line.ParentLineId.Value, out var parent) ? parent : line;
            var units = line.ParentLineId.HasValue ? (decimal)line.Quantity * root.Quantity : line.Quantity;
            var returnedUnits = notReturnedLineIds.Contains(root.LineId) ? 0m : units;
            weights.TryGetValue(line.ProductId, out var current);
            weights[line.ProductId] = (current.Returned + returnedUnits, current.Total + units);
        }

        return weights;
    }

    private async Task<string> ShortMessageAsync(Item item, decimal needed, CancellationToken cancellationToken)
    {
        var balance = await db.Items
            .AsNoTracking()
            .Where(i => i.Id == item.Id)
            .Select(i => i.CurrentQuantity)
            .FirstAsync(cancellationToken);
        var shortBy = StockRules.Shortfall(balance, needed);

        return $"Not enough {item.Name}: this order needs {Format(needed)} {InventoryUnitLabels.Abbreviate(item.UnitName)}, "
               + $"{Format(Math.Max(0m, balance))} {InventoryUnitLabels.Abbreviate(item.UnitName)} in stock (short by {Format(shortBy)} {InventoryUnitLabels.Abbreviate(item.UnitName)}).";
    }

    private static string? WarningFor(Item item, decimal after)
    {
        if (after < 0m)
        {
            return $"{item.Name} is below zero: {Format(after)} {InventoryUnitLabels.Abbreviate(item.UnitName)}. Count it and correct the stock.";
        }

        return StockRules.StatusFor(after, item.WarningQuantity, item.CriticalQuantity) == StockStatus.Ok
            ? null
            : $"{item.Name} is running low: {Format(after)} {InventoryUnitLabels.Abbreviate(item.UnitName)} left.";
    }

    private static string Format(decimal quantity) => quantity.ToString("0.###", CultureInfo.InvariantCulture);
}
