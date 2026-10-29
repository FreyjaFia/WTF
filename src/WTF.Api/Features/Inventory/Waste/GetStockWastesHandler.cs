using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Time;
using WTF.Api.Features.Inventory.Waste.DTOs;
using WTF.Calculations.Time;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory.Waste;

public record GetStockWastesQuery(
    DateTime? FromDate,
    DateTime? ToDate,
    Guid? ItemId,
    int? WasteReasonId,
    string? Status,
    Guid? CreatedBy,
    int Page = 1,
    int PageSize = 25) : IRequest<PagedStockWasteDto>;

public class GetStockWastesHandler(WTFDbContext db, IHttpContextAccessor? httpContextAccessor = null) : IRequestHandler<GetStockWastesQuery, PagedStockWasteDto>
{
    private const int MaxPageSize = 100;

    public async Task<PagedStockWasteDto> Handle(GetStockWastesQuery request, CancellationToken cancellationToken)
    {
        var status = StockWasteStatuses.Parse(request.Status);
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, MaxPageSize);

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

        var totalCount = await query.CountAsync(cancellationToken);
        var pendingCount = await db.StockWastes.AsNoTracking()
            .CountAsync(w => w.Status == StockWasteStatuses.PendingReview, cancellationToken);

        var items = await StockWasteMapping.Project(query
                .OrderByDescending(w => w.CreatedAt)
                .ThenByDescending(w => w.Id)
                .Skip((page - 1) * pageSize)
                .Take(pageSize))
            .ToListAsync(cancellationToken);

        return new PagedStockWasteDto(items, totalCount, pendingCount);
    }
}
