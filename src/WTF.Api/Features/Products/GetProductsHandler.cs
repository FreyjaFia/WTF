using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Products.DTOs;
using WTF.Api.Features.Products.Enums;
using WTF.Domain.Data;

namespace WTF.Api.Features.Products;

public record GetProductsQuery : IRequest<List<ProductDto>>
{
    public string? SearchTerm { get; init; }
    public ProductCategoryEnum? Category { get; init; }
    public bool? IsAddOn { get; init; }
    public bool? IsActive { get; init; } = true;
}

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

        if (products.Count == 0)
        {
            return [];
        }

        var productIds = products.Select(p => p.Id).ToList();
        var addOnCountByProductId = new Dictionary<Guid, int>();
        var linkedProductCountByAddOnId = new Dictionary<Guid, int>();

        if (request.IsAddOn == true)
        {
            linkedProductCountByAddOnId = await db.ProductAddOns
                .Where(pa => productIds.Contains(pa.AddOnId))
                .GroupBy(pa => pa.AddOnId)
                .Select(g => new { AddOnId = g.Key, LinkedProductCount = g.Count() })
                .ToDictionaryAsync(x => x.AddOnId, x => x.LinkedProductCount, cancellationToken);
        }
        else if (request.IsAddOn == false)
        {
            addOnCountByProductId = await db.ProductAddOns
                .Where(pa => productIds.Contains(pa.ProductId))
                .GroupBy(pa => pa.ProductId)
                .Select(g => new { ProductId = g.Key, AddOnCount = g.Count() })
                .ToDictionaryAsync(x => x.ProductId, x => x.AddOnCount, cancellationToken);
        }
        else
        {
            var links = await db.ProductAddOns
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

            return new ProductDto(
                p.Id,
                p.Name,
                p.Code,
                p.Description,
                p.Price,
                (ProductCategoryEnum)p.CategoryId,
                p.IsAddOn,
                p.IsActive,
                p.CreatedAt,
                p.CreatedBy,
                p.UpdatedAt,
                p.UpdatedBy,
                imageUrl,
                [],
                count
            );
        })];
    }
}
