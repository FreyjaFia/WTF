using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Products.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Products;

public record GetProductPriceHistoryQuery(Guid ProductId) : IRequest<List<ProductPriceHistoryDto>>;

public class GetProductPriceHistoryHandler(WTFDbContext db) : IRequestHandler<GetProductPriceHistoryQuery, List<ProductPriceHistoryDto>>
{
    public async Task<List<ProductPriceHistoryDto>> Handle(GetProductPriceHistoryQuery request, CancellationToken cancellationToken)
    {
        var history = await db.ProductPriceHistories
            .Include(h => h.UpdatedByNavigation)
            .Where(h => h.ProductId == request.ProductId)
            .OrderByDescending(h => h.UpdatedAt)
            .Select(h => new ProductPriceHistoryDto(
                h.Id,
                h.ProductId,
                h.OldPrice,
                h.NewPrice,
                h.UpdatedAt,
                h.UpdatedBy,
                $"{h.UpdatedByNavigation.FirstName} {h.UpdatedByNavigation.LastName}"
            ))
            .ToListAsync(cancellationToken);

        return history;
    }
}
