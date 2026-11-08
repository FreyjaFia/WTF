using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory.Receiving;

public record GetStockReceiptsQuery(Guid? SupplierId = null, DateOnly? From = null, DateOnly? To = null, string? Search = null, int Take = 100)
    : IRequest<List<StockReceiptSummaryDto>>;

public record GetStockReceiptQuery(Guid Id) : IRequest<StockReceiptDto?>;

public class GetStockReceiptsHandler(WTFDbContext db) : IRequestHandler<GetStockReceiptsQuery, List<StockReceiptSummaryDto>>
{
    public async Task<List<StockReceiptSummaryDto>> Handle(GetStockReceiptsQuery request, CancellationToken cancellationToken)
    {
        var query = db.StockReceipts.AsNoTracking();
        if (request.SupplierId.HasValue)
        {
            query = query.Where(r => r.SupplierId == request.SupplierId);
        }

        if (request.From.HasValue)
        {
            query = query.Where(r => r.ReceivedOn >= request.From);
        }

        if (request.To.HasValue)
        {
            query = query.Where(r => r.ReceivedOn <= request.To);
        }

        var search = request.Search?.Trim();
        if (!string.IsNullOrEmpty(search))
        {
            query = query.Where(r => (r.InvoiceNumber != null && r.InvoiceNumber.Contains(search)) || r.Supplier.Name.Contains(search));
        }

        var receipts = await query
            .OrderByDescending(r => r.ReceivedOn)
            .ThenByDescending(r => r.CreatedAt)
            .Take(Math.Clamp(request.Take, 1, 500))
            .Include(r => r.Supplier)
            .Include(r => r.CreatedByNavigation)
            .Include(r => r.StockReceiptLines)
            .AsSplitQuery()
            .ToListAsync(cancellationToken);

        return [.. receipts.Select(r => ReceiptMapping.ToSummary(r, r.StockReceiptLines.ToList()))];
    }
}

public class GetStockReceiptHandler(WTFDbContext db) : IRequestHandler<GetStockReceiptQuery, StockReceiptDto?>
{
    public Task<StockReceiptDto?> Handle(GetStockReceiptQuery request, CancellationToken cancellationToken) =>
        ReceiptMapping.LoadAsync(db, request.Id, cancellationToken);
}
