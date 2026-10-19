namespace WTF.Api.Features.Inventory.DTOs;

public record ProductCoverageDto(
    Guid ProductId,
    string Name,
    string Code,
    string Status,
    List<string> MissingOptions);

public record StockCoverageDto(
    int Covered,
    int Partial,
    int Missing,
    List<ProductCoverageDto> Products);
