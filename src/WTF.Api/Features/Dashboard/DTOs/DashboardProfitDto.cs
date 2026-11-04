namespace WTF.Api.Features.Dashboard.DTOs;

public record DashboardProfitDto(
    decimal NetSales,
    decimal ActualProfit,
    decimal? MarginPercent,
    string CostStatus,
    decimal WasteCost,
    decimal? WastePercent,
    string? TopVarianceItem,
    decimal? TopVarianceValue,
    decimal StockValue);
