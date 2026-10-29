using WTF.Api.Features.Inventory;
using WTF.Api.Features.Items.DTOs;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Items;

internal static class ItemMapping
{
    public static ItemDto ToDto(Item item, StockMovementLookups? lookups = null)
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
            item.AllowNegativeStock,
            item.WasteApprovalLimit,
            item.CreatedAt,
            item.CreatedBy,
            item.UpdatedAt,
            item.UpdatedBy,
            item.ItemPriceHistories
                .OrderByDescending(h => h.UpdatedAt)
                .Select(h => new ItemPriceHistoryDto(
                    h.Id,
                    h.ItemId,
                    h.OldPrice,
                    h.NewPrice,
                    h.UpdatedAt,
                    h.UpdatedBy,
                    $"{h.UpdatedByNavigation.FirstName} {h.UpdatedByNavigation.LastName}".Trim()))
                .ToList(),
            item.ProductItemLinks
                .OrderBy(l => l.Product.Name)
                .Select(l => new ProductItemLinkDto(
                    l.Id,
                    l.ProductId,
                    l.Product.Name,
                    l.Product.Code,
                    l.ItemId,
                    l.QuantityPerSale,
                    l.IsActive,
                    l.Product.IsActive))
                .ToList(),
            item.StockMovements
                .OrderByDescending(m => m.CreatedAt)
                .Select(m => StockMovementMapping.ToDto(m, lookups ?? StockMovementLookups.Empty))
                .ToList());
    }
}
