namespace WTF.Api.Features.Inventory.DTOs;

public record InventoryItemDto(
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
    DateTime CreatedAt,
    Guid CreatedBy,
    DateTime? UpdatedAt,
    Guid? UpdatedBy,
    List<ProductInventoryLinkDto> ProductLinks,
    List<StockMovementDto> RecentMovements);

public record ProductInventoryLinkDto(
    Guid Id,
    Guid ProductId,
    string ProductName,
    string ProductCode,
    Guid InventoryItemId,
    decimal QuantityPerSale,
    bool IsActive);

public record StockMovementDto(
    Guid Id,
    Guid InventoryItemId,
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
    string CreatedByName);
