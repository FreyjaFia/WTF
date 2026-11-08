using Microsoft.EntityFrameworkCore;
using WTF.Calculations.Inventory;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory.Purchasing;

internal static class PurchaseOrderMapping
{
    public static PurchaseOrderLineDto ToLineDto(PurchaseOrderLine line) =>
        new(line.ItemId, line.Item.Name, line.Item.UnitName, line.PackName, line.UnitsPerPack, line.PackPrice,
            line.PacksOrdered, line.PacksReceived, PurchasingRules.LineTotal(line.PacksOrdered, line.PackPrice));

    public static PurchaseOrderSummaryDto ToSummary(PurchaseOrder order, IReadOnlyCollection<PurchaseOrderLine> lines)
    {
        var totals = lines.Select(l => PurchasingRules.LineTotal(l.PacksOrdered, l.PackPrice)).ToList();
        decimal? total = totals.Count == 0 || totals.Any(t => t is null) ? null : totals.Sum(t => t!.Value);
        return new PurchaseOrderSummaryDto(
            order.Id, order.PoNumber, order.SupplierId, order.Supplier.Name, order.Status, order.ExpectedOn, order.Note,
            order.CreatedAt, order.CreatedByNavigation.Username, order.SentAt, lines.Count, total);
    }

    public static async Task<PurchaseOrderDto?> LoadAsync(WTFDbContext db, Guid id, CancellationToken cancellationToken)
    {
        var order = await db.PurchaseOrders
            .AsNoTracking()
            .Include(o => o.Supplier)
            .Include(o => o.CreatedByNavigation)
            .Include(o => o.PurchaseOrderLines).ThenInclude(l => l.Item)
            .AsSplitQuery()
            .FirstOrDefaultAsync(o => o.Id == id, cancellationToken);
        if (order is null)
        {
            return null;
        }

        var receiptIds = await db.StockReceipts
            .AsNoTracking()
            .Where(r => r.PurchaseOrderId == id)
            .OrderBy(r => r.CreatedAt)
            .Select(r => r.Id)
            .ToListAsync(cancellationToken);

        var lines = order.PurchaseOrderLines.OrderBy(l => l.Item.Name).ToList();
        return new PurchaseOrderDto(ToSummary(order, lines), [.. lines.Select(ToLineDto)], receiptIds);
    }
}
