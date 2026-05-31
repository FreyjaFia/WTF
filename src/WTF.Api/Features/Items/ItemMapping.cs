using WTF.Api.Features.Items.DTOs;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Items;

internal static class ItemMapping
{
    public static ItemDto ToDto(Item item)
    {
        return new ItemDto(
            item.Id,
            item.Name,
            item.Sku,
            item.Barcode,
            item.UnitName,
            item.StockUnitName,
            item.UnitsPerStockUnit,
            item.CurrentQuantity,
            item.CostPrice,
            item.WarningQuantity,
            item.CriticalQuantity,
            item.IsActive,
            item.CreatedAt,
            item.CreatedBy,
            item.UpdatedAt,
            item.UpdatedBy,
            item.ProductItemLinks
                .OrderBy(l => l.Product.Name)
                .Select(l => new ProductItemLinkDto(
                    l.Id,
                    l.ProductId,
                    l.Product.Name,
                    l.Product.Code,
                    l.ItemId,
                    l.QuantityPerSale,
                    l.IsActive))
                .ToList(),
            item.StockMovements
                .OrderByDescending(m => m.CreatedAt)
                .Select(m => new StockMovementDto(
                    m.Id,
                    m.ItemId,
                    m.MovementType,
                    m.QuantityDelta,
                    m.QuantityBefore,
                    m.QuantityAfter,
                    m.UnitCost,
                    m.ReferenceType,
                    m.ReferenceId,
                    m.Notes,
                    m.CreatedAt,
                    m.CreatedBy,
                    $"{m.CreatedByNavigation.FirstName} {m.CreatedByNavigation.LastName}".Trim()))
                .ToList());
    }
}
