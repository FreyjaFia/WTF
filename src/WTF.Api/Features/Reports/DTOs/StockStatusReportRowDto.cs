namespace WTF.Api.Features.Reports.DTOs;

public sealed record StockStatusReportRowDto(
    Guid ItemId,
    string ItemName,
    string UnitName,
    decimal CurrentQuantity,
    decimal? WarningQuantity,
    decimal? CriticalQuantity,
    string Status,
    decimal? CostPrice,
    decimal StockValue
);
