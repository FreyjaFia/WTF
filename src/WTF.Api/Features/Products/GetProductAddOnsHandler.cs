using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Products.DTOs;
using WTF.Api.Features.Products.Enums;
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
            .Where(pa => pa.ProductId == request.ProductId)
            .Include(pa => pa.AddOn)
                .ThenInclude(p => p.ProductImage)
                    .ThenInclude(pi => pi!.Image)
            .Include(pa => pa.ProductAddOnPriceOverride)
            .Where(pa => pa.AddOn.IsActive)
            .Select(pa => new
            {
                AddOnType = (AddOnTypeEnum)(pa.AddOnTypeId ?? (int)AddOnTypeEnum.Extra),
                pa.AddOn,
                OverridePrice = pa.ProductAddOnPriceOverride != null && pa.ProductAddOnPriceOverride.IsActive
                    ? (decimal?)pa.ProductAddOnPriceOverride.Price
                    : null
            })
            .ToListAsync(cancellationToken);

        var groupedAddOns = addOns
            .GroupBy(a => a.AddOnType)
            .Select(group => new AddOnGroupDto(
                group.Key,
                group.Key.ToString(),
                [.. group.Select(item =>
                {
                    var imageUrl = item.AddOn.ProductImage != null && item.AddOn.ProductImage.Image != null
                        ? UrlExtensions.ToAbsoluteUrl(httpContextAccessor, item.AddOn.ProductImage.Image.ImageUrl)
                        : null;

                    return new ProductDto(
                        item.AddOn.Id,
                        item.AddOn.Name,
                        item.AddOn.Code,
                        item.AddOn.Description,
                        item.AddOn.Price,
                        (ProductCategoryEnum)item.AddOn.CategoryId,
                        item.AddOn.IsAddOn,
                        item.AddOn.IsActive,
                        item.AddOn.CreatedAt,
                        item.AddOn.CreatedBy,
                        item.AddOn.UpdatedAt,
                        item.AddOn.UpdatedBy,
                        imageUrl,
                        [],
                        OverridePrice: item.OverridePrice
                    );
                })]
            ))
            .OrderBy(group => group.Type)
            .ToList();

        return groupedAddOns;
    }
}
