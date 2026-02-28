namespace WTF.Api.Features.Reports.DTOs;

public sealed record ProductSalesReportRowDto(
    Guid ProductId,
    string ProductName,
    string CategoryName,
    string? SubCategoryName,
    int QuantitySold,
    decimal Revenue,
    decimal RevenuePercent
);
