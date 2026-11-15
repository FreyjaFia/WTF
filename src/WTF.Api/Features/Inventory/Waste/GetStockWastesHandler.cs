using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.DTOs;
using WTF.Api.Common.Time;
using WTF.Api.Features.Inventory.Waste.DTOs;
using WTF.Calculations.Time;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory.Waste;

public record GetStockWastesQuery(
    DateTime? FromDate,
    DateTime? ToDate,
    Guid? ItemId,
    int? WasteReasonId,
    string? Status,
    Guid? CreatedBy,
    int Page = 1,
    int PageSize = 25,
    string? SearchTerm = null,
    string? SortBy = null,
    string? SortDirection = null) : IRequest<PagedStockWasteDto>;

public class GetStockWastesHandler(WTFDbContext db, IHttpContextAccessor? httpContextAccessor = null) : IRequestHandler<GetStockWastesQuery, PagedStockWasteDto>
{
    public async Task<PagedStockWasteDto> Handle(GetStockWastesQuery request, CancellationToken cancellationToken)
    {
        var status = StockWasteStatuses.Parse(request.Status);
        var paging = PagingRequest.From(request.Page, request.PageSize, 25);

        var query = db.StockWastes.AsNoTracking();

        var timeZone = httpContextAccessor is null
            ? TimeZoneInfo.Utc
            : RequestTimeZone.ResolveFromRequest(httpContextAccessor);

        if (request.FromDate.HasValue)
        {
            var (fromUtc, _) = ReportDateRange.ToUtcRange(request.FromDate.Value, request.FromDate.Value, timeZone);
            query = query.Where(w => w.CreatedAt >= fromUtc);
        }

        if (request.ToDate.HasValue)
        {
            var (_, toExclusiveUtc) = ReportDateRange.ToUtcRange(request.ToDate.Value, request.ToDate.Value, timeZone);
            query = query.Where(w => w.CreatedAt < toExclusiveUtc);
        }

        if (request.ItemId.HasValue)
        {
            query = query.Where(w => w.ItemId == request.ItemId.Value);
        }

        if (request.WasteReasonId.HasValue)
        {
            query = query.Where(w => w.WasteReasonId == request.WasteReasonId.Value);
        }

        if (request.CreatedBy.HasValue)
        {
            query = query.Where(w => w.CreatedBy == request.CreatedBy.Value);
        }

        if (status.HasValue)
        {
            query = query.Where(w => w.Status == status.Value);
        }

        if (!string.IsNullOrWhiteSpace(request.SearchTerm))
        {
            var term = request.SearchTerm.Trim().ToLower();
            query = query.Where(w =>
                w.Item.Name.ToLower().Contains(term) ||
                w.ReasonName.ToLower().Contains(term) ||
                (w.Notes != null && w.Notes.ToLower().Contains(term)) ||
                (w.CreatedByNavigation.FirstName + " " + w.CreatedByNavigation.LastName).ToLower().Contains(term));
        }

        var totalCount = await query.CountAsync(cancellationToken);
        var pendingCount = await db.StockWastes.AsNoTracking()
            .CountAsync(w => w.Status == StockWasteStatuses.PendingReview, cancellationToken);

        paging = paging.ClampToTotal(totalCount);

        var items = await StockWasteMapping.Project(ApplySort(query, request).ApplyPaging(paging))
            .ToListAsync(cancellationToken);

        return new PagedStockWasteDto(items, totalCount, pendingCount, paging.Page, paging.PageSize);
    }

    private static IQueryable<StockWaste> ApplySort(IQueryable<StockWaste> query, GetStockWastesQuery request)
    {
        var descending = !string.Equals(request.SortDirection, "asc", StringComparison.OrdinalIgnoreCase);
        var column = request.SortBy?.Trim().ToLowerInvariant();

        return (column, descending) switch
        {
            ("item", false) => query.OrderBy(w => w.Item.Name).ThenBy(w => w.Id),
            ("item", true) => query.OrderByDescending(w => w.Item.Name).ThenByDescending(w => w.Id),
            ("quantity", false) => query.OrderBy(w => w.Quantity).ThenBy(w => w.Id),
            ("quantity", true) => query.OrderByDescending(w => w.Quantity).ThenByDescending(w => w.Id),
            ("status", false) => query.OrderBy(w => w.Status).ThenBy(w => w.Id),
            ("status", true) => query.OrderByDescending(w => w.Status).ThenByDescending(w => w.Id),
            ("recorded", false) => query.OrderBy(w => w.CreatedAt).ThenBy(w => w.Id),
            _ => query.OrderByDescending(w => w.CreatedAt).ThenByDescending(w => w.Id),
        };
    }
}
