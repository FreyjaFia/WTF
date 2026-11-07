using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Catalog;
using WTF.Api.Features.Products.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Products;

public record GetProductAddOnsQuery(Guid ProductId) : IRequest<List<AddOnGroupDto>>;

public class GetProductAddOnsHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetProductAddOnsQuery, List<AddOnGroupDto>>
{
    public async Task<List<AddOnGroupDto>> Handle(GetProductAddOnsQuery request, CancellationToken cancellationToken)
    {
        var productExists = await db.Products
            .AnyAsync(p => p.Id == request.ProductId, cancellationToken);

        if (!productExists)
        {
            return [];
        }

        var addOns = await db.ProductAddOns
            .Where(pa => pa.IsActive)
            .Where(pa => pa.ProductId == request.ProductId)
            .Include(pa => pa.AddOn)
                .ThenInclude(p => p.ProductImage)
                    .ThenInclude(pi => pi!.Image)
            .Include(pa => pa.ProductAddOnPriceOverride)
            .Where(pa => pa.AddOn.IsActive)
            .Select(pa => new
            {
                AddOnType = pa.AddOnTypeId ?? SystemAddOnTypes.Extra,
                TypeName = pa.AddOnType != null ? pa.AddOnType.Name : "Extra",
                TypeSort = pa.AddOnType != null ? pa.AddOnType.SortOrder : SystemAddOnTypes.Extra,
                TypeRequired = pa.AddOnType != null && pa.AddOnType.IsRequired,
                TypeMin = pa.AddOnType != null ? pa.AddOnType.MinSelect : 0,
                TypeMax = pa.AddOnType != null ? pa.AddOnType.MaxSelect : 0,
                pa.AddOn,
                OverridePrice = pa.ProductAddOnPriceOverride != null && pa.ProductAddOnPriceOverride.IsActive
                    ? (decimal?)pa.ProductAddOnPriceOverride.Price
                    : null
            })
            .ToListAsync(cancellationToken);

        var groupedAddOns = addOns
            .GroupBy(a => new { a.AddOnType, a.TypeName, a.TypeSort, a.TypeRequired, a.TypeMin, a.TypeMax })
            .OrderBy(group => group.Key.TypeSort).ThenBy(group => group.Key.AddOnType)
            .Select(group => new AddOnGroupDto(
                group.Key.AddOnType,
                group.Key.TypeName,
                [.. group.Select(item =>
                {
                    var imageUrl = item.AddOn.ProductImage != null && item.AddOn.ProductImage.Image != null
                        ? UrlExtensions.ToAbsoluteUrl(httpContextAccessor, item.AddOn.ProductImage.Image.ImageUrl)
                        : null;

                    return ProductMapping.ToDto(item.AddOn, imageUrl, new List<ProductPriceHistoryDto>(), overridePrice: item.OverridePrice);
                })],
                group.Key.TypeRequired, group.Key.TypeMin, group.Key.TypeMax
            ))
            .ToList();

        return groupedAddOns;
    }
}
