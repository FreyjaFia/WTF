using Microsoft.EntityFrameworkCore;
using WTF.Calculations.Inventory;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory.Receiving;

internal static class ReceiptMapping
{
    public static StockReceiptLineDto ToLineDto(StockReceiptLine line) =>
        new(line.ItemId, line.Item.Name, line.Item.UnitName, line.PackName, line.Packs, line.UnitsPerPack, line.PackPrice,
            line.Quantity, line.UnitCost, PurchasingRules.LineTotal(line.Packs, line.PackPrice));

    public static StockReceiptSummaryDto ToSummary(StockReceipt receipt, IReadOnlyCollection<StockReceiptLine> lines)
    {
        var lineTotals = lines.Select(l => PurchasingRules.LineTotal(l.Packs, l.PackPrice)).ToList();
        decimal? linesTotal = lineTotals.Any(t => t is null) ? null : lineTotals.Sum(t => t!.Value);
        return new StockReceiptSummaryDto(
            receipt.Id, receipt.SupplierId, receipt.Supplier.Name, receipt.ReceivedOn, receipt.InvoiceNumber,
            receipt.InvoiceTotal, linesTotal, PurchasingRules.InvoiceDifference(receipt.InvoiceTotal, lineTotals),
            receipt.Note, receipt.CreatedAt, receipt.CreatedByNavigation.Username, lines.Count, receipt.PurchaseOrderId,
            receipt.PurchaseOrder?.PoNumber);
    }

    public static async Task<StockReceiptDto?> LoadAsync(WTFDbContext db, Guid id, CancellationToken cancellationToken)
    {
        var receipt = await db.StockReceipts
            .AsNoTracking()
            .Include(r => r.Supplier)
            .Include(r => r.CreatedByNavigation)
            .Include(r => r.PurchaseOrder)
            .Include(r => r.StockReceiptLines).ThenInclude(l => l.Item)
            .FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
        if (receipt is null)
        {
            return null;
        }

        var lines = receipt.StockReceiptLines.OrderBy(l => l.Item.Name).ToList();
        return new StockReceiptDto(ToSummary(receipt, lines), [.. lines.Select(ToLineDto)]);
    }
}
