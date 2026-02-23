namespace WTF.Api.Features.Dashboard.DTOs;

public record TopSellingProductDto(
    Guid ProductId,
    string ProductName,
    int QuantitySold,
    decimal Revenue,
    string? ImageUrl);
