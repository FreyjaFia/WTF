namespace WTF.Api.Features.Inventory.Waste.DTOs;

public record PosWasteItemDto(
    Guid Id,
    string Name,
    string BaseUnit,
    string? StockUnitName,
    decimal? UnitsPerStockUnit,
    decimal CurrentQuantity,
    bool AllowNegativeStock,
    decimal? WasteApprovalLimit);
