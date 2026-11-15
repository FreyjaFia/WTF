using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Products.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Products;

public record GetProductsQuery : IRequest<List<ProductDto>>
{
    public string? SearchTerm { get; init; }
    public int? Category { get; init; }
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
            query = query.Where(p => p.CategoryId == request.Category.Value);
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

        return await ProductListMapper.MapAsync(db, httpContextAccessor, products, request.IsAddOn, cancellationToken);
    }
}
