using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Inventory.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory;

public record GetPosStockLimitsQuery : IRequest<PosStockLimitsDto>;

// What the register needs to tell a cashier, before payment, that a cart cannot be sold: only the items that block sales
// when they run short (active, "allow sales below zero" off), their balances and which products take them. Everything else
// about stock stays with the stock roles.
public class GetPosStockLimitsHandler(WTFDbContext db) : IRequestHandler<GetPosStockLimitsQuery, PosStockLimitsDto>
{
    public async Task<PosStockLimitsDto> Handle(GetPosStockLimitsQuery request, CancellationToken cancellationToken)
    {
        var items = await db.Items
            .AsNoTracking()
            .Where(item => item.IsActive && !item.AllowNegativeStock)
            .OrderBy(item => item.Name)
            .Select(item => new { item.Id, item.Name, item.UnitName, item.CurrentQuantity })
            .ToListAsync(cancellationToken);

        var itemIds = items.Select(item => item.Id).ToList();
        var links = await db.ProductItemLinks
            .AsNoTracking()
            .Where(link => link.IsActive && itemIds.Contains(link.ItemId))
            .Select(link => new StockLimitLinkDto(link.ProductId, link.ItemId, link.QuantityPerSale))
            .ToListAsync(cancellationToken);

        return new PosStockLimitsDto(
            [.. items.Select(item => new StockLimitItemDto(
                item.Id, item.Name, InventoryUnitLabels.Abbreviate(item.UnitName), item.CurrentQuantity))],
            links,
            DateTime.UtcNow);
    }
}
