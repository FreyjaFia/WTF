namespace WTF.Api.Features.Reports.DTOs;

public sealed record ProductSalesReportRowDto(
    Guid ProductId,
    string ProductName,
    string CategoryName,
    string? SubCategoryName,
    int QuantitySold,
    decimal Revenue,
    decimal RevenuePercent,
    bool IsAddOn = false,
    decimal GrossSales = 0m,
    decimal Discounts = 0m,
    decimal RefundedAmount = 0m
);
