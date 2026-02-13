using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Contracts.Products;
using WTF.Contracts.Products.Queries;
using WTF.Domain.Data;
using ContractEnum = WTF.Contracts.Products.Enums.ProductCategoryEnum;

namespace WTF.Api.Features.Products;

public class GetProductAddOnsHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetProductAddOnsQuery, List<ProductSimpleDto>>
{
    public async Task<List<ProductSimpleDto>> Handle(GetProductAddOnsQuery request, CancellationToken cancellationToken)
    {
        var product = await db.Products.FindAsync([request.ProductId], cancellationToken);

        if (product == null)
        {
            return [];
        }

        var addOns = await db.Products
            .Where(p => p.Products.Any(parent => parent.Id == request.ProductId))
            .Where(p => p.IsActive)
            .Include(p => p.ProductImage)
                .ThenInclude(pi => pi!.Image)
            .Select(p => new ProductSimpleDto(
                p.Id,
                p.Name,
                p.Price,
                (ContractEnum)p.CategoryId,
                p.IsActive,
                p.ProductImage != null && p.ProductImage.Image != null
                    ? UrlExtensions.ToAbsoluteUrl(httpContextAccessor, p.ProductImage.Image.ImageUrl)
                    : null
            ))
            .ToListAsync(cancellationToken);

        return addOns;
    }
}
