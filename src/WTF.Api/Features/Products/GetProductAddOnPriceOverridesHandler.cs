using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Products.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Products;

public record GetProductAddOnPriceOverridesQuery(Guid ProductId) : IRequest<List<ProductAddOnPriceOverrideDto>>;

public class GetProductAddOnPriceOverridesHandler(WTFDbContext db) : IRequestHandler<GetProductAddOnPriceOverridesQuery, List<ProductAddOnPriceOverrideDto>>
{
    public async Task<List<ProductAddOnPriceOverrideDto>> Handle(GetProductAddOnPriceOverridesQuery request, CancellationToken cancellationToken)
    {
        var productExists = await db.Products
            .AnyAsync(p => p.Id == request.ProductId, cancellationToken);

        if (!productExists)
        {
            return [];
        }

        var overrides = await db.ProductAddOnPriceOverrides
            .Where(o => o.ProductId == request.ProductId)
            .OrderBy(o => o.AddOnId)
            .Select(o => new ProductAddOnPriceOverrideDto(
                o.ProductId,
                o.AddOnId,
                o.Price,
                o.IsActive
            ))
            .ToListAsync(cancellationToken);

        return overrides;
    }
}
