using WTF.Contracts.Products.Enums;

namespace WTF.Contracts.Products;

public record ProductDto(
    Guid Id,
    string Name,
    string Code,
    string? Description,
    decimal Price,
    ProductCategoryEnum Category,
    bool IsAddOn,
    bool IsActive,
    DateTime CreatedAt,
    Guid CreatedBy,
    DateTime? UpdatedAt,
    Guid? UpdatedBy,
    string? ImageUrl,
    List<ProductPriceHistoryDto> PriceHistory,
    int AddOnCount = 0
)
{
    public string DisplayCategory => Category.ToString();
    public string FormattedPrice => $"₱{Price:N2}";
    public string ProductCategory => IsAddOn ? "Add-on" : "Main Product";
}
