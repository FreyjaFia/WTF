namespace WTF.Api.Features.Reports.DTOs;

public sealed record DailySalesReportRowDto(
    DateTime PeriodStart,
    decimal TotalRevenue,
    int OrderCount,
    decimal AverageOrderValue,
    decimal TipsTotal,
    int VoidCancelledCount
);
