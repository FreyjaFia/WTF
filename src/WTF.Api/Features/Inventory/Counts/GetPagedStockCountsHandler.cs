using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory.Counts;

public sealed record GetPagedStockCountsQuery(
    byte? Status = null,
    string? SortBy = null,
    string? SortDirection = null,
    int Page = 1,
    int PageSize = 25) : IRequest<PagedResultDto<StockCountSummaryDto>>;

public sealed class GetPagedStockCountsHandler(WTFDbContext db)
    : IRequestHandler<GetPagedStockCountsQuery, PagedResultDto<StockCountSummaryDto>>
{
    public async Task<PagedResultDto<StockCountSummaryDto>> Handle(GetPagedStockCountsQuery request, CancellationToken cancellationToken)
    {
        var paging = PagingRequest.From(request.Page, request.PageSize, 25);
        var query = db.StockCounts.AsNoTracking().Where(c => request.Status == null || c.Status == request.Status);

        var totalCount = await query.CountAsync(cancellationToken);
        if (totalCount == 0)
        {
            return new PagedResultDto<StockCountSummaryDto>([], paging.Page, paging.PageSize, 0);
        }

        paging = paging.ClampToTotal(totalCount);

        var items = await ApplySort(query, request)
            .ApplyPaging(paging)
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

        return new PagedResultDto<StockCountSummaryDto>(items, paging.Page, paging.PageSize, totalCount);
    }

    private static IQueryable<StockCount> ApplySort(IQueryable<StockCount> query, GetPagedStockCountsQuery request)
    {
        var ascending = string.Equals(request.SortDirection, "asc", StringComparison.OrdinalIgnoreCase);
        var column = request.SortBy?.Trim().ToLowerInvariant();

        return (column, ascending) switch
        {
            ("count", true) => query.OrderBy(c => c.Name).ThenBy(c => c.Id),
            ("count", false) => query.OrderByDescending(c => c.Name).ThenByDescending(c => c.Id),
            ("status", true) => query.OrderBy(c => c.Status).ThenBy(c => c.Id),
            ("status", false) => query.OrderByDescending(c => c.Status).ThenByDescending(c => c.Id),
            ("progress", true) => query.OrderBy(Progress).ThenBy(c => c.Id),
            ("progress", false) => query.OrderByDescending(Progress).ThenByDescending(c => c.Id),
            ("created", true) => query.OrderBy(c => c.CreatedAt).ThenBy(c => c.Id),
            _ => query.OrderByDescending(c => c.CreatedAt).ThenByDescending(c => c.Id),
        };
    }

    private static readonly System.Linq.Expressions.Expression<Func<StockCount, double>> Progress =
        c => c.StockCountLines.Count == 0
            ? 0d
            : (double)c.StockCountLines.Count(l => l.CountedQuantity != null) / c.StockCountLines.Count;
}
