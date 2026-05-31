using WTF.Api.Features.Products.DTOs;
using WTF.Api.Features.Products.Enums;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Products;

internal static class ProductMapping
{
    public static ProductDto ToDto(Product product, string? imageUrl, List<ProductPriceHistoryDto> priceHistory, int addOnCount = 0, decimal? overridePrice = null)
    {
        return new ProductDto(
            product.Id,
            product.Name,
            product.Code,
            product.Description,
            product.Price,
            (ProductCategoryEnum)product.CategoryId,
            product.SubCategoryId.HasValue ? (ProductSubCategoryEnum)product.SubCategoryId.Value : null,
            product.IsAddOn,
            product.IsActive,
            product.CreatedAt,
            product.CreatedBy,
            product.UpdatedAt,
            product.UpdatedBy,
            imageUrl,
            priceHistory,
            addOnCount,
            overridePrice
        );
    }

    public static string NormalizeCode(string code)
    {
        return code.Trim().ToUpperInvariant();
    }
}
