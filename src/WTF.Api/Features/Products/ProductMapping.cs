using WTF.Api.Features.Products.DTOs;
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
            product.CategoryId,
            product.SubCategoryId,
            product.IsAddOn,
            product.IsActive,
            product.CreatedAt,
            product.CreatedBy,
            product.UpdatedAt,
            product.UpdatedBy,
            imageUrl,
            priceHistory,
            addOnCount,
            overridePrice,
            product.IsSeniorPwdEligible
        );
    }

    public static string NormalizeCode(string code)
    {
        return code.Trim().ToUpperInvariant();
    }
}
