using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory.Counts;

public record GetStockCountsQuery(byte? Status = null) : IRequest<List<StockCountSummaryDto>>;

public record GetStockCountQuery(Guid Id) : IRequest<StockCountDto?>;

public class GetStockCountsHandler(WTFDbContext db) : IRequestHandler<GetStockCountsQuery, List<StockCountSummaryDto>>
{
    public async Task<List<StockCountSummaryDto>> Handle(GetStockCountsQuery request, CancellationToken cancellationToken) =>
        await db.StockCounts
            .AsNoTracking()
            .Where(c => request.Status == null || c.Status == request.Status)
            .OrderByDescending(c => c.CreatedAt)
            .Take(100)
            .Select(c => new StockCountSummaryDto(
                c.Id,
                c.Name,
                c.Status,
                c.IsBlind,
                c.Note,
                c.CreatedAt,
                c.CreatedByNavigation.FirstName + " " + c.CreatedByNavigation.LastName,
                c.PostedAt,
                c.StockCountLines.Count,
                c.StockCountLines.Count(l => l.CountedQuantity != null)))
            .ToListAsync(cancellationToken);
}

public class GetStockCountHandler(WTFDbContext db) : IRequestHandler<GetStockCountQuery, StockCountDto?>
{
    public Task<StockCountDto?> Handle(GetStockCountQuery request, CancellationToken cancellationToken) =>
        StockCountMapping.LoadAsync(db, request.Id, cancellationToken);
}
