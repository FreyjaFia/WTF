namespace WTF.Api.Features.Items.DTOs;

public record ItemDto(
    Guid Id,
    string Name,
    string? Sku,
    string? Barcode,
    string UnitName,
    string? StockUnitName,
    decimal? UnitsPerStockUnit,
    decimal CurrentQuantity,
    decimal? CostPrice,
    decimal? WarningQuantity,
    decimal? CriticalQuantity,
    bool IsActive,
    bool AllowNegativeStock,
    DateTime CreatedAt,
    Guid CreatedBy,
    DateTime? UpdatedAt,
    Guid? UpdatedBy,
    List<ItemPriceHistoryDto> PriceHistory,
    List<ProductItemLinkDto> ProductLinks,
    List<StockMovementDto> RecentMovements);

public record StockMovementDto(
    Guid Id,
    Guid ItemId,
    string MovementType,
    decimal QuantityDelta,
    decimal QuantityBefore,
    decimal QuantityAfter,
    decimal? UnitCost,
    string? ReferenceType,
    Guid? ReferenceId,
    string? Notes,
    DateTime CreatedAt,
    Guid CreatedBy,
    string CreatedByName,
    Guid? ProductId = null,
    string? ProductName = null,
    int? OrderNumber = null);

public record PagedStockMovementsDto(List<StockMovementDto> Items, int TotalCount);
