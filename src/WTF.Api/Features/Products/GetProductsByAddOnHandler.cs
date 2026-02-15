using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Contracts.Products;
using WTF.Contracts.Products.Queries;
using WTF.Domain.Data;
using ContractEnum = WTF.Contracts.Products.Enums.ProductCategoryEnum;

namespace WTF.Api.Features.Products;

public class GetProductsByAddOnHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetProductsByAddOnQuery, List<ProductSimpleDto>>
{
    public async Task<List<ProductSimpleDto>> Handle(GetProductsByAddOnQuery request, CancellationToken cancellationToken)
    {
        var addOn = await db.Products.FindAsync([request.AddOnId], cancellationToken);

        if (addOn == null || !addOn.IsAddOn)
        {
            return [];
        }

        var products = await db.Products
            .Where(p => p.AddOns.Any(addon => addon.Id == request.AddOnId))
            .Where(p => p.IsActive)
            .Include(p => p.ProductImage)
                .ThenInclude(pi => pi!.Image)
            .Select(p => new ProductSimpleDto(
                p.Id,
                p.Name,
                p.Code,
                p.Description,
                p.Price,
                (ContractEnum)p.CategoryId,
                p.IsActive,
                p.ProductImage != null && p.ProductImage.Image != null
                    ? UrlExtensions.ToAbsoluteUrl(httpContextAccessor, p.ProductImage.Image.ImageUrl)
                    : null
            ))
            .ToListAsync(cancellationToken);

        return products;
    }
}
