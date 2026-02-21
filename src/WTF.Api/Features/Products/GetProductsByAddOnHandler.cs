using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Products.DTOs;
using WTF.Api.Features.Products.Enums;
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
            .Where(pa => pa.AddOnId == request.AddOnId)
            .Where(pa => pa.Product.IsActive)
            .Include(pa => pa.Product)
                .ThenInclude(p => p.ProductImage)
                    .ThenInclude(pi => pi!.Image)
            .Select(pa => new
            {
                pa.Product,
                AddOnType = (AddOnTypeEnum)(pa.AddOnTypeId ?? (int)AddOnTypeEnum.Extra)
            })
            .ToListAsync(cancellationToken);

        // Group products by the add-on type configured on the ProductAddOn relationship
        var groups = productLinks
            .GroupBy(x => x.AddOnType)
            .Select(group => new AddOnGroupDto(
                group.Key,
                group.Key.ToString(),
                [.. group.Select(item =>
                {
                    var product = item.Product;
                    var imageUrl = product.ProductImage != null && product.ProductImage.Image != null
                        ? UrlExtensions.ToAbsoluteUrl(httpContextAccessor, product.ProductImage.Image.ImageUrl)
                        : null;

                    return new ProductDto(
                        product.Id,
                        product.Name,
                        product.Code,
                        product.Description,
                        product.Price,
                        (ProductCategoryEnum)product.CategoryId,
                        product.IsAddOn,
                        product.IsActive,
                        product.CreatedAt,
                        product.CreatedBy,
                        product.UpdatedAt,
                        product.UpdatedBy,
                        imageUrl,
                        []
                    );
                })]
            ))
            .OrderBy(g => g.Type)
            .ToList();

        return groups;
    }
}
