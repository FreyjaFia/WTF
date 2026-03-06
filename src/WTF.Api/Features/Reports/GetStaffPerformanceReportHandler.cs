using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Time;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Reports;

public sealed record GetStaffPerformanceReportQuery : IRequest<List<StaffPerformanceReportRowDto>>
{
    public DateTime FromDate { get; init; }
    public DateTime ToDate { get; init; }
    public Guid? StaffId { get; init; }
}

public sealed class GetStaffPerformanceReportHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetStaffPerformanceReportQuery, List<StaffPerformanceReportRowDto>>
{
    public async Task<List<StaffPerformanceReportRowDto>> Handle(GetStaffPerformanceReportQuery request, CancellationToken cancellationToken)
    {
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var (fromUtc, toExclusiveUtc) = ReportDateRange.ToUtcRange(request.FromDate, request.ToDate, timeZone);

        var query = db.Orders
            .AsNoTracking()
            .Include(o => o.CreatedByNavigation)
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .Include(o => o.OrderBundlePromotions)
            .Where(o =>
                o.CreatedAt >= fromUtc
                && o.CreatedAt < toExclusiveUtc
                && o.StatusId == (int)OrderStatusEnum.Completed);

        if (request.StaffId.HasValue)
        {
            query = query.Where(o => o.CreatedBy == request.StaffId.Value);
        }

        var orders = await query.ToListAsync(cancellationToken);
        var overridePrices = await BuildAddOnOverridePriceLookup(orders, cancellationToken);

        var grouped = orders
            .GroupBy(o => new
            {
                o.CreatedBy,
                o.CreatedByNavigation.FirstName,
                o.CreatedByNavigation.LastName
            })
            .Select(g => new
            {
                StaffId = g.Key.CreatedBy,
                StaffName = $"{g.Key.FirstName} {g.Key.LastName}".Trim(),
                OrderCount = g.Count(),
                TotalRevenue = g.Sum(o => OrderMetrics.ComputeOrderTotal(o, overridePrices)),
                TipsReceived = g.Sum(o => o.Tips ?? 0m)
            })
            .OrderByDescending(r => r.TotalRevenue)
            .ToList();

        return grouped
            .Select(row => new StaffPerformanceReportRowDto(
                row.StaffId,
                row.StaffName,
                row.OrderCount,
                row.TotalRevenue,
                row.OrderCount > 0 ? row.TotalRevenue / row.OrderCount : 0m,
                row.TipsReceived))
            .ToList();
    }

    private async Task<Dictionary<(Guid ProductId, Guid AddOnId), decimal>> BuildAddOnOverridePriceLookup(
        IReadOnlyCollection<Order> orders,
        CancellationToken cancellationToken)
    {
        var parentProductIds = orders
            .SelectMany(o => o.OrderItems.Where(oi => oi.ParentOrderItemId == null))
            .Select(oi => oi.ProductId)
            .Distinct()
            .ToList();

        var addOnProductIds = orders
            .SelectMany(o => o.OrderItems.Where(oi => oi.ParentOrderItemId != null))
            .Select(oi => oi.ProductId)
            .Distinct()
            .ToList();

        if (addOnProductIds.Count == 0)
        {
            return [];
        }

        return await db.ProductAddOnPriceOverrides
            .Where(o => parentProductIds.Contains(o.ProductId)
                && addOnProductIds.Contains(o.AddOnId)
                && o.IsActive)
            .ToDictionaryAsync(o => (o.ProductId, o.AddOnId), o => o.Price, cancellationToken);
    }
}
