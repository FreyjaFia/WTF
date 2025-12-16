using WTF.Contracts.Products.Enums;

namespace WTF.Contracts.Products;

public record ProductDto(
    Guid Id,
    string Name,
    decimal Price,
    ProductTypeEnum Type,
    bool IsAddOn,
    bool IsActive,
    DateTime CreatedAt,
    Guid CreatedBy,
    DateTime? UpdatedAt,
    Guid? UpdatedBy,
    string? ImageUrl
)
{
    public string DisplayType => Type.ToString();
    public string FormattedPrice => $"₱{Price:N2}";
    public string ProductCategory => IsAddOn ? "Add-on" : "Main Product";
}
