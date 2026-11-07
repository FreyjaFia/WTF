using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Catalog;
using WTF.Api.Features.Products.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Products;

public record GetProductsByAddOnQuery(Guid AddOnId) : IRequest<List<AddOnGroupDto>>;

public class GetProductsByAddOnHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetProductsByAddOnQuery, List<AddOnGroupDto>>
{
    public async Task<List<AddOnGroupDto>> Handle(GetProductsByAddOnQuery request, CancellationToken cancellationToken)
    {
        var addOnExists = await db.Products
            .AnyAsync(p => p.Id == request.AddOnId && p.IsAddOn, cancellationToken);

        if (!addOnExists)
        {
            return [];
        }

        var productLinks = await db.ProductAddOns
            .Where(pa => pa.IsActive)
            .Where(pa => pa.AddOnId == request.AddOnId)
            .Where(pa => pa.Product.IsActive)
            .Include(pa => pa.Product)
                .ThenInclude(p => p.ProductImage)
                    .ThenInclude(pi => pi!.Image)
            .Select(pa => new
            {
                pa.Product,
                AddOnType = pa.AddOnTypeId ?? SystemAddOnTypes.Extra,
                TypeName = pa.AddOnType != null ? pa.AddOnType.Name : "Extra",
                TypeSort = pa.AddOnType != null ? pa.AddOnType.SortOrder : SystemAddOnTypes.Extra,
                TypeRequired = pa.AddOnType != null && pa.AddOnType.IsRequired,
                TypeMin = pa.AddOnType != null ? pa.AddOnType.MinSelect : 0,
                TypeMax = pa.AddOnType != null ? pa.AddOnType.MaxSelect : 0
            })
            .ToListAsync(cancellationToken);

        // Group products by the add-on type configured on the ProductAddOn relationship
        var groups = productLinks
            .GroupBy(x => new { x.AddOnType, x.TypeName, x.TypeSort, x.TypeRequired, x.TypeMin, x.TypeMax })
            .OrderBy(group => group.Key.TypeSort).ThenBy(group => group.Key.AddOnType)
            .Select(group => new AddOnGroupDto(
                group.Key.AddOnType,
                group.Key.TypeName,
                [.. group.Select(item =>
                {
                    var product = item.Product;
                    var imageUrl = product.ProductImage != null && product.ProductImage.Image != null
                        ? UrlExtensions.ToAbsoluteUrl(httpContextAccessor, product.ProductImage.Image.ImageUrl)
                        : null;

                    return ProductMapping.ToDto(product, imageUrl, new List<ProductPriceHistoryDto>());
                })],
                group.Key.TypeRequired, group.Key.TypeMin, group.Key.TypeMax
            ))
            .ToList();

        return groups;
    }
}
