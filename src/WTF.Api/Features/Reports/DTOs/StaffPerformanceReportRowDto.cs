namespace WTF.Api.Features.Reports.DTOs;

public sealed record StaffPerformanceReportRowDto(
    Guid StaffId,
    string StaffName,
    int OrderCount,
    decimal TotalRevenue,
    decimal AverageOrderValue,
    decimal TipsReceived,
    decimal GrossSales = 0m,
    decimal Discounts = 0m,
    decimal RefundedAmount = 0m
);
