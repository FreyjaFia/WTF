using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Time;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports.DTOs;
using WTF.Api.Features.Reports.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Reports;

public sealed record GetDailySalesReportQuery : IRequest<List<DailySalesReportRowDto>>
{
    public DateTime FromDate { get; init; }
    public DateTime ToDate { get; init; }
    public ReportGroupByEnum GroupBy { get; init; } = ReportGroupByEnum.Day;
}

public sealed class GetDailySalesReportHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetDailySalesReportQuery, List<DailySalesReportRowDto>>
{
    public async Task<List<DailySalesReportRowDto>> Handle(GetDailySalesReportQuery request, CancellationToken cancellationToken)
    {
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var (fromUtc, toExclusiveUtc) = ReportDateRange.ToUtcRange(request.FromDate, request.ToDate, timeZone);

        var orders = await db.Orders
            .AsNoTracking()
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .Where(o => o.CreatedAt >= fromUtc && o.CreatedAt < toExclusiveUtc)
            .ToListAsync(cancellationToken);

        return orders
            .GroupBy(o => ResolvePeriodStart(o.CreatedAt, request.GroupBy, timeZone))
            .OrderBy(g => g.Key)
            .Select(group =>
            {
                var completedOrders = group
                    .Where(o => o.StatusId == (int)OrderStatusEnum.Completed)
                    .ToList();

                var revenue = completedOrders.Sum(ComputeOrderRevenue);
                var orderCount = completedOrders.Count;
                var average = orderCount > 0 ? revenue / orderCount : 0m;
                var tips = completedOrders.Sum(o => o.Tips ?? 0m);
                var voidCancelledCount = group.Count(o =>
                    o.StatusId == (int)OrderStatusEnum.Cancelled
                    || o.StatusId == (int)OrderStatusEnum.Refunded);

                return new DailySalesReportRowDto(
                    group.Key,
                    revenue,
                    orderCount,
                    average,
                    tips,
                    voidCancelledCount);
            })
            .ToList();
    }

    private static DateTime ResolvePeriodStart(
        DateTime createdAtUtc,
        ReportGroupByEnum groupBy,
        TimeZoneInfo timeZone)
    {
        var localDate = TimeZoneInfo.ConvertTimeFromUtc(
            ReportDateRange.EnsureUtcDate(createdAtUtc),
            timeZone).Date;

        if (groupBy == ReportGroupByEnum.Week)
        {
            var offset = ((int)localDate.DayOfWeek + 6) % 7;
            return DateTime.SpecifyKind(localDate.AddDays(-offset), DateTimeKind.Unspecified);
        }

        if (groupBy == ReportGroupByEnum.Month)
        {
            return DateTime.SpecifyKind(
                new DateTime(localDate.Year, localDate.Month, 1),
                DateTimeKind.Unspecified);
        }

        return DateTime.SpecifyKind(localDate, DateTimeKind.Unspecified);
    }

    private static decimal ComputeOrderRevenue(Order order)
    {
        return order.OrderItems.Sum(oi => (oi.Price ?? oi.Product.Price) * oi.Quantity);
    }
}
