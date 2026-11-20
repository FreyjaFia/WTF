namespace WTF.Api.Features.Inventory.DTOs;

public record StockAttentionItemDto(
    Guid Id,
    string Name,
    string UnitName,
    decimal CurrentQuantity,
    decimal? WarningQuantity,
    decimal? CriticalQuantity,
    string Status,
    bool AllowNegativeStock,
    int ProductCount,
    int SalesCovered,
    Guid? BranchId = null,
    string? BranchName = null);

public record StockAttentionDto(
    List<StockAttentionItemDto> Items,
    int OutCount,
    int CriticalCount,
    int WarningCount,
    int TotalCount);
