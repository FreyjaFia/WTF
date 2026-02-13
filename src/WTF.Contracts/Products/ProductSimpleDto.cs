using WTF.Contracts.Products.Enums;

namespace WTF.Contracts.Products;

public record ProductSimpleDto(
    Guid Id,
    string Name,
    decimal Price,
    ProductCategoryEnum Category,
    bool IsActive,
    string? ImageUrl
);
