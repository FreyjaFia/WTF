namespace WTF.Api.Features.Reports.DTOs;

public sealed record MenuEngineeringReportRowDto(
    Guid ProductId,
    string ProductName,
    string CategoryName,
    int QuantitySold,
    decimal Revenue,
    decimal? GrossProfit,
    decimal? UnitProfit,
    decimal? PopularityPercent,
    string MenuClass,
    string CostStatus);
