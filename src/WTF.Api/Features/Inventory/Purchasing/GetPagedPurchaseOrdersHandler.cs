using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory.Purchasing;

public sealed record GetPagedPurchaseOrdersQuery(
    byte? Status = null,
    Guid? SupplierId = null,
    bool OpenOnly = false,
    string? Search = null,
    string? SortBy = null,
    string? SortDirection = null,
    int Page = 1,
    int PageSize = 25) : IRequest<PagedResultDto<PurchaseOrderSummaryDto>>;

public sealed class GetPagedPurchaseOrdersHandler(WTFDbContext db)
    : IRequestHandler<GetPagedPurchaseOrdersQuery, PagedResultDto<PurchaseOrderSummaryDto>>
{
    public async Task<PagedResultDto<PurchaseOrderSummaryDto>> Handle(GetPagedPurchaseOrdersQuery request, CancellationToken cancellationToken)
    {
        var paging = PagingRequest.From(request.Page, request.PageSize, 25);
        var query = db.PurchaseOrders.AsNoTracking();

        if (request.OpenOnly)
        {
            query = query.Where(o => o.Status == PurchaseOrderStatuses.Sent || o.Status == PurchaseOrderStatuses.PartlyReceived);
        }

        if (request.SupplierId.HasValue)
        {
            query = query.Where(o => o.SupplierId == request.SupplierId);
        }

        var search = request.Search?.Trim();
        if (!string.IsNullOrEmpty(search))
        {
            query = query.Where(o =>
                ("PO-" + o.PoNumber).Contains(search)
                || o.Supplier.Name.Contains(search)
                || (o.Note != null && o.Note.Contains(search))
                || o.CreatedByNavigation.Username.Contains(search));
        }

        // Counts for the status filter follow the search but not the status itself.
        var counts = await query
            .GroupBy(o => o.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        var facets = counts.ToDictionary(c => c.Status.ToString(), c => c.Count);
        facets["all"] = counts.Sum(c => c.Count);

        if (request.Status.HasValue)
        {
            query = query.Where(o => o.Status == request.Status);
        }

        var totalCount = await query.CountAsync(cancellationToken);
        if (totalCount == 0)
        {
            return new PagedResultDto<PurchaseOrderSummaryDto>([], paging.Page, paging.PageSize, 0, facets);
        }

        paging = paging.ClampToTotal(totalCount);

        var orders = await ApplySort(query, request)
            .ApplyPaging(paging)
            .Include(o => o.Supplier)
            .Include(o => o.CreatedByNavigation)
            .Include(o => o.PurchaseOrderLines)
            .ToListAsync(cancellationToken);

        return new PagedResultDto<PurchaseOrderSummaryDto>(
            [.. orders.Select(o => PurchaseOrderMapping.ToSummary(o, o.PurchaseOrderLines.ToList()))],
            paging.Page,
            paging.PageSize,
            totalCount,
            facets);
    }

    private static IQueryable<PurchaseOrder> ApplySort(IQueryable<PurchaseOrder> query, GetPagedPurchaseOrdersQuery request)
    {
        var ascending = string.Equals(request.SortDirection, "asc", StringComparison.OrdinalIgnoreCase);
        var column = request.SortBy?.Trim().ToLowerInvariant();

        return (column, ascending) switch
        {
            ("order", true) => query.OrderBy(o => o.PoNumber).ThenBy(o => o.Id),
            ("order", false) => query.OrderByDescending(o => o.PoNumber).ThenByDescending(o => o.Id),
            ("expected", true) => query.OrderBy(o => o.ExpectedOn).ThenBy(o => o.Id),
            ("expected", false) => query.OrderByDescending(o => o.ExpectedOn).ThenByDescending(o => o.Id),
            ("status", true) => query.OrderBy(o => o.Status).ThenBy(o => o.Id),
            ("status", false) => query.OrderByDescending(o => o.Status).ThenByDescending(o => o.Id),
            ("total", true) => query.OrderBy(OrderTotal).ThenBy(o => o.Id),
            ("total", false) => query.OrderByDescending(OrderTotal).ThenByDescending(o => o.Id),
            _ => query.OrderByDescending(o => o.CreatedAt).ThenByDescending(o => o.Id),
        };
    }

    // An order with an unpriced line has no total, so it sorts below the priced ones.
    private static readonly System.Linq.Expressions.Expression<Func<PurchaseOrder, decimal>> OrderTotal =
        o => o.PurchaseOrderLines.Any(l => l.PackPrice == null)
            ? -1m
            : o.PurchaseOrderLines.Sum(l => l.PacksOrdered * l.PackPrice!.Value);
}
