namespace WTF.Api.Features.Products.DTOs;

public record ProductSoldAtRowDto(Guid BranchId, string BranchName, string BranchCode, bool IsMain, bool IsSoldHere);

public record ProductSoldAtDto(
    Guid ProductId,
    string ProductName,
    bool IsAllBranches,
    bool CanChange,
    bool CanSellEverywhere,
    List<ProductSoldAtRowDto> Branches);

public record ProductSoldAtInputDto(bool IsAllBranches, List<Guid>? BranchIds);
