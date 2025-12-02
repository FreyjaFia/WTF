using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Contracts.Products;
using WTF.Contracts.Products.Queries;
using WTF.Domain.Data;
using ContractEnum = WTF.Contracts.Products.Enums.ProductTypeEnum;

namespace WTF.Api.Features.Products;

public class GetProductsHandler(WTFDbContext db) : IRequestHandler<GetProductsQuery, ProductListDto>
{
    public async Task<ProductListDto> Handle(GetProductsQuery request, CancellationToken cancellationToken)
    {
        var query = db.Products.AsQueryable();

        // Apply filters
        if (!string.IsNullOrWhiteSpace(request.SearchTerm))
        {
            query = query.Where(p => p.Name.Contains(request.SearchTerm));
        }

        if (request.Type.HasValue)
        {
            query = query.Where(p => p.TypeId == (int)request.Type.Value); // Compare int values
        }

        if (request.IsAddOn.HasValue)
        {
            query = query.Where(p => p.IsAddOn == request.IsAddOn.Value);
        }

        if (request.IsActive.HasValue)
        {
            query = query.Where(p => p.IsActive == request.IsActive.Value);
        }

        // Get total count before pagination
        var totalCount = await query.CountAsync(cancellationToken);

        // Apply pagination
        var products = await query
            .OrderBy(p => p.Name)
            .Skip((request.Page - 1) * request.PageSize)
            .Take(request.PageSize)
            .Select(p => new ProductDto(
                p.Id,
                p.Name,
                p.Price,
                (ContractEnum)p.TypeId, // Convert int to contract enum
                p.IsAddOn,
                p.IsActive,
                p.CreatedAt,
                p.CreatedBy,
                p.UpdatedAt,
                p.UpdatedBy
            ))
            .ToListAsync(cancellationToken);

        return new ProductListDto(
            products,
            totalCount,
            request.Page,
            request.PageSize
        );
    }
}
