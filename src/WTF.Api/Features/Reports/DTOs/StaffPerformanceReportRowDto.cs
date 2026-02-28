namespace WTF.Api.Features.Reports.DTOs;

public sealed record StaffPerformanceReportRowDto(
    Guid StaffId,
    string StaffName,
    int OrderCount,
    decimal TotalRevenue,
    decimal AverageOrderValue,
    decimal TipsReceived
);
