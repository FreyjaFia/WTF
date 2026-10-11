using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Products.DTOs;
using WTF.Api.Features.Products.Enums;
using WTF.Domain.Data;

namespace WTF.Api.Features.Sync;

/// <summary>
/// Loads the sellable catalog (active non-add-on products and their add-ons). Shared by the authenticated POS
/// sync and the public ordering page so both always show the same products and prices.
/// </summary>
internal static class PosCatalogLoader
{
    public static async Task<List<ProductDto>> LoadProductsAsync(
        WTFDbContext db, IHttpContextAccessor httpContextAccessor, CancellationToken cancellationToken)
    {
        var products = await db.Products
            .Where(p => !p.IsAddOn && p.IsActive)
            .Include(p => p.ProductImage)
                .ThenInclude(pi => pi!.Image)
            .OrderBy(p => p.Name)
            .ToListAsync(cancellationToken);

        var productIds = products.Select(p => p.Id).ToList();

        var addOnCounts = await db.ProductAddOns
            .Where(pa => pa.IsActive)
            .Where(pa => productIds.Contains(pa.ProductId))
            .GroupBy(pa => pa.ProductId)
            .Select(g => new { ProductId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.ProductId, x => x.Count, cancellationToken);

        return [.. products.Select(p =>
        {
            var imageUrl = p.ProductImage?.Image != null
                ? UrlExtensions.ToAbsoluteUrl(httpContextAccessor, p.ProductImage.Image.ImageUrl)
                : null;

            return new ProductDto(
                p.Id, p.Name, p.Code, p.Description, p.Price,
                (ProductCategoryEnum)p.CategoryId,
                p.SubCategoryId.HasValue ? (ProductSubCategoryEnum)p.SubCategoryId.Value : null,
                p.IsAddOn, p.IsActive, p.CreatedAt, p.CreatedBy, p.UpdatedAt, p.UpdatedBy,
                imageUrl, [],
                AddOnCount: addOnCounts.GetValueOrDefault(p.Id));
        })];
    }

    public static async Task<Dictionary<Guid, List<AddOnGroupDto>>> LoadAddOnsByProductIdAsync(
        WTFDbContext db, IHttpContextAccessor httpContextAccessor,
        List<ProductDto> products, CancellationToken cancellationToken)
    {
        var productIds = products.Select(p => p.Id).ToList();

        var allAddOns = await db.ProductAddOns
            .Where(pa => pa.IsActive)
            .Where(pa => productIds.Contains(pa.ProductId))
            .Include(pa => pa.AddOn)
                .ThenInclude(a => a.ProductImage)
                    .ThenInclude(pi => pi!.Image)
            .Include(pa => pa.ProductAddOnPriceOverride)
            .Where(pa => pa.AddOn.IsActive)
            .Select(pa => new
            {
                pa.ProductId,
                AddOnType = (AddOnTypeEnum)(pa.AddOnTypeId ?? (int)AddOnTypeEnum.Extra),
                pa.AddOn,
                OverridePrice = pa.ProductAddOnPriceOverride != null && pa.ProductAddOnPriceOverride.IsActive
                    ? (decimal?)pa.ProductAddOnPriceOverride.Price
                    : null
            })
            .ToListAsync(cancellationToken);

        return allAddOns
            .GroupBy(a => a.ProductId)
            .ToDictionary(
                productGroup => productGroup.Key,
                productGroup => productGroup
                    .GroupBy(a => a.AddOnType)
                    .Select(typeGroup => new AddOnGroupDto(
                        typeGroup.Key,
                        typeGroup.Key.ToString(),
                        [.. typeGroup.Select(item =>
                        {
                            var imageUrl = item.AddOn.ProductImage?.Image != null
                                ? UrlExtensions.ToAbsoluteUrl(httpContextAccessor, item.AddOn.ProductImage.Image.ImageUrl)
                                : null;

                            return new ProductDto(
                                item.AddOn.Id, item.AddOn.Name, item.AddOn.Code, item.AddOn.Description,
                                item.AddOn.Price,
                                (ProductCategoryEnum)item.AddOn.CategoryId,
                                item.AddOn.SubCategoryId.HasValue ? (ProductSubCategoryEnum)item.AddOn.SubCategoryId.Value : null,
                                item.AddOn.IsAddOn, item.AddOn.IsActive,
                                item.AddOn.CreatedAt, item.AddOn.CreatedBy, item.AddOn.UpdatedAt, item.AddOn.UpdatedBy,
                                imageUrl, [],
                                OverridePrice: item.OverridePrice);
                        })]
                    ))
                    .OrderBy(g => g.Type)
                    .ToList()
            );
    }
}
