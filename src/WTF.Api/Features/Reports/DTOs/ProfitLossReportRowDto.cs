namespace WTF.Api.Features.Reports.DTOs;

public sealed record ProfitLossReportRowDto(
    DateTime PeriodStart,
    decimal NetSales,
    decimal Cost,
    decimal WasteCost,
    decimal CountVariance,
    decimal? ActualProfit,
    decimal Expenses,
    decimal? OperatingProfit,
    decimal? MarginPercent,
    string CostStatus);
