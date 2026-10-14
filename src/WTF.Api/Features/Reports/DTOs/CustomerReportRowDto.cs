namespace WTF.Api.Features.Reports.DTOs;

public sealed record CustomerReportRowDto(
    Guid CustomerId,
    string CustomerName,
    int OrderCount,
    decimal TotalSpent,
    decimal AverageOrderValue,
    DateTime LastVisit,
    bool IsNew,
    int LoyaltyPoints
);
