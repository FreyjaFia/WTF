using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Contracts.Products;
using WTF.Contracts.Products.Queries;
using WTF.Domain.Data;
using ContractEnum = WTF.Contracts.Products.Enums.ProductCategoryEnum;

namespace WTF.Api.Features.Products;

public class GetProductsHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetProductsQuery, List<ProductDto>>
{
    public async Task<List<ProductDto>> Handle(GetProductsQuery request, CancellationToken cancellationToken)
    {
        var query = db.Products
            .Include(p => p.ProductImage)
                .ThenInclude(pi => pi!.Image)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(request.SearchTerm))
        {
            query = query.Where(p => p.Name.Contains(request.SearchTerm));
        }

        if (request.Category.HasValue)
        {
            query = query.Where(p => p.CategoryId == (int)request.Category.Value);
        }

        if (request.IsAddOn.HasValue)
        {
            query = query.Where(p => p.IsAddOn == request.IsAddOn.Value);
        }

        if (request.IsActive.HasValue)
        {
            query = query.Where(p => p.IsActive == request.IsActive.Value);
        }

        var products = await query
            .OrderBy(p => p.Name)
            .ToListAsync(cancellationToken);

        return [.. products.Select(p =>
        {
            var imageUrl = p.ProductImage != null && p.ProductImage.Image != null
                ? p.ProductImage.Image.ImageUrl
                : null;

            imageUrl = UrlExtensions.ToAbsoluteUrl(httpContextAccessor, imageUrl);

            return new ProductDto(
                p.Id,
                p.Name,
                p.Price,
                (ContractEnum)p.CategoryId,
                p.IsAddOn,
                p.IsActive,
                p.CreatedAt,
                p.CreatedBy,
                p.UpdatedAt,
                p.UpdatedBy,
                imageUrl,
                []
            );
        })];
    }
}
