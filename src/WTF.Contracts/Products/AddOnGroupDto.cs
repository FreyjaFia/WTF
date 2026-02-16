using WTF.Contracts.Products.Enums;

namespace WTF.Contracts.Products;

public record AddOnGroupDto(
    AddOnTypeEnum Type,
    string DisplayName,
    List<ProductSimpleDto> Options
);
