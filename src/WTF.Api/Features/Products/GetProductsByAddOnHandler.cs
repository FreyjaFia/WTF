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

        var products = await db.ProductAddOns
            .Where(pa => pa.AddOnId == request.AddOnId)
            .Where(pa => pa.Product.IsActive)
            .Select(pa => new ProductSimpleDto(
                pa.Product.Id,
                pa.Product.Name,
                pa.Product.Code,
                pa.Product.Description,
                pa.Product.Price,
                (ContractEnum)pa.Product.CategoryId,
                pa.Product.IsActive,
                pa.Product.ProductImage != null && pa.Product.ProductImage.Image != null
                    ? UrlExtensions.ToAbsoluteUrl(httpContextAccessor, pa.Product.ProductImage.Image.ImageUrl)
                    : null
            ))
            .ToListAsync(cancellationToken);

        return products;
    }
}
