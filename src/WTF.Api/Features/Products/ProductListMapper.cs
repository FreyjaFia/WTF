using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Products.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Products;

internal static class ProductListMapper
{
    public static async Task<List<ProductDto>> MapAsync(
        WTFDbContext db,
        IHttpContextAccessor httpContextAccessor,
        List<Product> products,
        bool? isAddOnFilter,
        CancellationToken cancellationToken)
    {
        var productIds = products.Select(p => p.Id).ToList();
        var addOnCountByProductId = new Dictionary<Guid, int>();
        var linkedProductCountByAddOnId = new Dictionary<Guid, int>();

        if (isAddOnFilter == true)
        {
            linkedProductCountByAddOnId = await db.ProductAddOns
                .Where(pa => pa.IsActive)
                .Where(pa => productIds.Contains(pa.AddOnId))
                .GroupBy(pa => pa.AddOnId)
                .Select(g => new { AddOnId = g.Key, LinkedProductCount = g.Count() })
                .ToDictionaryAsync(x => x.AddOnId, x => x.LinkedProductCount, cancellationToken);
        }
        else if (isAddOnFilter == false)
        {
            addOnCountByProductId = await db.ProductAddOns
                .Where(pa => pa.IsActive)
                .Where(pa => productIds.Contains(pa.ProductId))
                .GroupBy(pa => pa.ProductId)
                .Select(g => new { ProductId = g.Key, AddOnCount = g.Count() })
                .ToDictionaryAsync(x => x.ProductId, x => x.AddOnCount, cancellationToken);
        }
        else
        {
            var links = await db.ProductAddOns
                .Where(pa => pa.IsActive)
                .Where(pa => productIds.Contains(pa.ProductId) || productIds.Contains(pa.AddOnId))
                .Select(pa => new { pa.ProductId, pa.AddOnId })
                .ToListAsync(cancellationToken);

            addOnCountByProductId = links
                .GroupBy(x => x.ProductId)
                .ToDictionary(g => g.Key, g => g.Count());

            linkedProductCountByAddOnId = links
                .GroupBy(x => x.AddOnId)
                .ToDictionary(g => g.Key, g => g.Count());
        }

        return [.. products.Select(p =>
        {
            var imageUrl = p.ProductImage != null && p.ProductImage.Image != null
                ? p.ProductImage.Image.ImageUrl
                : null;

            imageUrl = UrlExtensions.ToAbsoluteUrl(httpContextAccessor, imageUrl);
            var count = 0;
            if (p.IsAddOn)
            {
                linkedProductCountByAddOnId.TryGetValue(p.Id, out count);
            }
            else
            {
                addOnCountByProductId.TryGetValue(p.Id, out count);
            }

            return ProductMapping.ToDto(p, imageUrl, new List<ProductPriceHistoryDto>(), count);
        })];
    }
}
