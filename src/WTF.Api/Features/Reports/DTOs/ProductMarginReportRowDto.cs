namespace WTF.Api.Features.Reports.DTOs;

public sealed record ProductMarginReportRowDto(
    Guid ProductId,
    string ProductName,
    string CategoryName,
    string? SubCategoryName,
    int QuantitySold,
    decimal Revenue,
    decimal? Cost,
    decimal? GrossProfit,
    decimal? MarginPercent,
    string CostStatus,
    bool IsAddOn = false
);
