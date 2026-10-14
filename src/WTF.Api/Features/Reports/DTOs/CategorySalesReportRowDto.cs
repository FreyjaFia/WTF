namespace WTF.Api.Features.Reports.DTOs;

public sealed record CategorySalesReportRowDto(
    string CategoryName,
    int QuantitySold,
    decimal GrossSales,
    decimal Discounts,
    decimal RefundedAmount,
    decimal Revenue,
    decimal RevenuePercent
);
