namespace WTF.Api.Features.Reports.DTOs;

public sealed record GrossProfitReportRowDto(
    DateTime PeriodStart,
    decimal NetSales,
    decimal Cost,
    decimal? TheoreticalProfit,
    decimal WasteCost,
    decimal CountVariance,
    decimal? ActualProfit,
    decimal? MarginPercent,
    string CostStatus);
