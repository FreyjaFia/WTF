using WTF.Api.Features.Products.Enums;

namespace WTF.Api.Features.Products.DTOs;

public record ProductDto(
    Guid Id, string Name, string Code, string? Description, decimal Price, ProductCategoryEnum Category,
    bool IsAddOn, bool IsActive, DateTime CreatedAt, Guid CreatedBy, DateTime? UpdatedAt, Guid? UpdatedBy,
    string? ImageUrl, List<ProductPriceHistoryDto> PriceHistory, int AddOnCount = 0, decimal? OverridePrice = null)
{
    public decimal EffectivePrice => OverridePrice ?? Price;
    public string DisplayCategory => Category.ToString();
    public string FormattedPrice => $"₱{EffectivePrice:N2}";
    public bool HasOverridePrice => OverridePrice.HasValue;
    public string ProductCategory => IsAddOn ? "Add-on" : "Main Product";
}
