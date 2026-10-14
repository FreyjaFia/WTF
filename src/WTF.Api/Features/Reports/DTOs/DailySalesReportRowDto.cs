namespace WTF.Api.Features.Reports.DTOs;

public sealed record DailySalesReportRowDto(
    DateTime PeriodStart,
    decimal TotalRevenue,
    int OrderCount,
    decimal AverageOrderValue,
    decimal TipsTotal,
    int VoidCancelledCount,
    int RefundedCount = 0,
    decimal RefundedAmount = 0m,
    decimal GrossSales = 0m,
    decimal NetSales = 0m,
    decimal Discounts = 0m
);
