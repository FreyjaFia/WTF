namespace WTF.Api.Features.Products.DTOs;

public record ProductBranchPriceRowDto(
    Guid BranchId,
    string BranchName,
    string BranchCode,
    bool IsMain,
    decimal? Price,
    decimal EffectivePrice);

public record ProductBranchPricesDto(Guid ProductId, string ProductName, decimal ShopPrice, List<ProductBranchPriceRowDto> Branches);

public record ProductBranchPriceInputDto(Guid BranchId, decimal? Price);
