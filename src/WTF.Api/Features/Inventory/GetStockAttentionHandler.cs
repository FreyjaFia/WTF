using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Inventory.DTOs;
using WTF.Calculations.Inventory;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory;

public record GetStockAttentionQuery : IRequest<StockAttentionDto>;

// What is low right now, worst first: the stock people's to-do list. It reads the items, not the saved alerts, so it is
// always the current state (an alert that was read or cleared does not hide an item that is still low).
public class GetStockAttentionHandler(WTFDbContext db) : IRequestHandler<GetStockAttentionQuery, StockAttentionDto>
{
    public async Task<StockAttentionDto> Handle(GetStockAttentionQuery request, CancellationToken cancellationToken)
    {
        // One row per item and branch the person may see: Makati can be out of milk while BGC is fine.
        var items = await db.ItemBranchStocks
            .AsNoTracking()
            .Where(s => s.Item.IsActive && s.Branch.IsActive)
            .Select(s => new
            {
                s.Item.Id,
                s.Item.Name,
                s.Item.UnitName,
                s.CurrentQuantity,
                WarningQuantity = s.WarningQuantity ?? s.Item.WarningQuantity,
                CriticalQuantity = s.CriticalQuantity ?? s.Item.CriticalQuantity,
                s.Item.AllowNegativeStock,
                s.BranchId,
                BranchName = s.Branch.Name,
                Links = s.Item.ProductItemLinkItems.Where(l => l.IsActive && l.Product.IsActive).Select(l => new { l.QuantityPerSale, l.AllowancePercent }).ToList()
            })
            .ToListAsync(cancellationToken);

        var needing = items
            .Select(i => new
            {
                Item = i,
                Status = StockRules.StatusFor(i.CurrentQuantity, i.WarningQuantity, i.CriticalQuantity)
            })
            .Where(x => x.Status != StockStatus.Ok)
            .OrderByDescending(x => x.Status)
            .ThenBy(x => x.Item.CurrentQuantity)
            .ThenBy(x => x.Item.Name)
            .Select(x => new StockAttentionItemDto(
                x.Item.Id,
                x.Item.Name,
                InventoryUnitLabels.Abbreviate(x.Item.UnitName),
                x.Item.CurrentQuantity,
                x.Item.WarningQuantity,
                x.Item.CriticalQuantity,
                x.Status.ToString(),
                x.Item.AllowNegativeStock,
                x.Item.Links.Count,
                x.Item.Links.Count == 0 ? 0 : x.Item.Links.Min(l => StockRules.SalesCovered(x.Item.CurrentQuantity, CostRules.EffectiveQuantity(l.QuantityPerSale, l.AllowancePercent))),
                x.Item.BranchId,
                x.Item.BranchName))
            .ToList();

        return new StockAttentionDto(
            needing,
            needing.Count(i => i.Status == nameof(StockStatus.OutOfStock)),
            needing.Count(i => i.Status == nameof(StockStatus.Critical)),
            needing.Count(i => i.Status == nameof(StockStatus.Warning)),
            needing.Count);
    }
}
