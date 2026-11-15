using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory.Receiving;

public sealed record GetPagedStockReceiptsQuery(
    Guid? SupplierId = null,
    DateOnly? From = null,
    DateOnly? To = null,
    string? Search = null,
    string? SortBy = null,
    string? SortDirection = null,
    int Page = 1,
    int PageSize = 25) : IRequest<PagedResultDto<StockReceiptSummaryDto>>;

public sealed class GetPagedStockReceiptsHandler(WTFDbContext db)
    : IRequestHandler<GetPagedStockReceiptsQuery, PagedResultDto<StockReceiptSummaryDto>>
{
    public async Task<PagedResultDto<StockReceiptSummaryDto>> Handle(GetPagedStockReceiptsQuery request, CancellationToken cancellationToken)
    {
        var paging = PagingRequest.From(request.Page, request.PageSize, 25);
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
            query = query.Where(r =>
                r.Supplier.Name.Contains(search)
                || (r.InvoiceNumber != null && r.InvoiceNumber.Contains(search))
                || (r.Note != null && r.Note.Contains(search))
                || r.CreatedByNavigation.Username.Contains(search)
                || (r.PurchaseOrder != null && ("PO-" + r.PurchaseOrder.PoNumber).Contains(search)));
        }

        var totalCount = await query.CountAsync(cancellationToken);
        if (totalCount == 0)
        {
            return new PagedResultDto<StockReceiptSummaryDto>([], paging.Page, paging.PageSize, 0);
        }

        paging = paging.ClampToTotal(totalCount);

        var receipts = await ApplySort(query, request)
            .ApplyPaging(paging)
            .Include(r => r.Supplier)
            .Include(r => r.CreatedByNavigation)
            .Include(r => r.PurchaseOrder)
            .Include(r => r.StockReceiptLines)
            .ToListAsync(cancellationToken);

        return new PagedResultDto<StockReceiptSummaryDto>(
            [.. receipts.Select(r => ReceiptMapping.ToSummary(r, r.StockReceiptLines.ToList()))],
            paging.Page,
            paging.PageSize,
            totalCount);
    }

    private static IQueryable<StockReceipt> ApplySort(IQueryable<StockReceipt> query, GetPagedStockReceiptsQuery request)
    {
        var ascending = string.Equals(request.SortDirection, "asc", StringComparison.OrdinalIgnoreCase);
        var column = request.SortBy?.Trim().ToLowerInvariant();

        return (column, ascending) switch
        {
            ("receipt", true) => query.OrderBy(r => r.Supplier.Name).ThenBy(r => r.Id),
            ("receipt", false) => query.OrderByDescending(r => r.Supplier.Name).ThenByDescending(r => r.Id),
            ("items", true) => query.OrderBy(r => r.StockReceiptLines.Count).ThenBy(r => r.Id),
            ("items", false) => query.OrderByDescending(r => r.StockReceiptLines.Count).ThenByDescending(r => r.Id),
            ("total", true) => query.OrderBy(LinesTotal).ThenBy(r => r.Id),
            ("total", false) => query.OrderByDescending(LinesTotal).ThenByDescending(r => r.Id),
            ("received", true) => query.OrderBy(r => r.ReceivedOn).ThenBy(r => r.CreatedAt).ThenBy(r => r.Id),
            _ => query.OrderByDescending(r => r.ReceivedOn).ThenByDescending(r => r.CreatedAt).ThenByDescending(r => r.Id),
        };
    }

    // A receipt with an unpriced line has no total, so it sorts below the priced ones.
    private static readonly System.Linq.Expressions.Expression<Func<StockReceipt, decimal>> LinesTotal =
        r => r.StockReceiptLines.Any(l => l.PackPrice == null)
            ? -1m
            : r.StockReceiptLines.Sum(l => l.Packs * l.PackPrice!.Value);
}
