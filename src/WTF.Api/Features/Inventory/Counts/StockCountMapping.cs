using Microsoft.EntityFrameworkCore;
using WTF.Calculations.Inventory;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory.Counts;

internal static class StockCountMapping
{
    public static async Task<StockCountDto?> LoadAsync(WTFDbContext db, Guid id, CancellationToken cancellationToken)
    {
        var count = await db.StockCounts
            .AsNoTracking()
            .Where(c => c.Id == id)
            .Select(c => new
            {
                c.Id,
                c.Name,
                c.Status,
                c.IsBlind,
                c.Note,
                c.CreatedAt,
                CreatedByName = c.CreatedByNavigation.Username,
                c.PostedAt
            })
            .FirstOrDefaultAsync(cancellationToken);
        if (count is null)
        {
            return null;
        }

        var rows = await db.StockCountLines
            .AsNoTracking()
            .Where(l => l.CountId == id)
            .OrderBy(l => l.Item.Name)
            .Select(l => new
            {
                l.ItemId,
                ItemName = l.Item.Name,
                l.Item.UnitName,
                l.CountedQuantity,
                l.ExpectedQuantity,
                l.MovementId
            })
            .ToListAsync(cancellationToken);

        var hidden = count.IsBlind && count.Status == StockCountStatuses.Open;
        var lines = rows
            .Select(l => new StockCountLineDto(
                l.ItemId,
                l.ItemName,
                InventoryUnitLabels.Abbreviate(l.UnitName),
                l.CountedQuantity,
                hidden ? null : l.ExpectedQuantity,
                hidden || !l.CountedQuantity.HasValue || !l.ExpectedQuantity.HasValue
                    ? null
                    : StockRules.AdjustmentDelta(l.ExpectedQuantity.Value, l.CountedQuantity.Value),
                l.MovementId.HasValue))
            .ToList();

        return new StockCountDto(
            new StockCountSummaryDto(
                count.Id, count.Name, count.Status, count.IsBlind, count.Note, count.CreatedAt, count.CreatedByName,
                count.PostedAt, lines.Count, lines.Count(l => l.CountedQuantity.HasValue)),
            lines);
    }
}
