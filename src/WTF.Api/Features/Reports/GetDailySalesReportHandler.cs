using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Time;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports.DTOs;
using WTF.Api.Features.Reports.Enums;
using WTF.Calculations.Sales;
using WTF.Calculations.Time;
using WTF.Domain.Data;

namespace WTF.Api.Features.Reports;

public sealed record GetDailySalesReportQuery : IRequest<List<DailySalesReportRowDto>>
{
    public DateTime? FromDate { get; init; }
    public DateTime? ToDate { get; init; }
    public ReportGroupByEnum? GroupBy { get; init; }
    /// <summary>Only orders that came from this source: the shop itself or a customer ordering link. Null means all.</summary>
    public OrderSourceEnum? Source { get; init; }
}

public sealed class GetDailySalesReportHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetDailySalesReportQuery, List<DailySalesReportRowDto>>
{
    public async Task<List<DailySalesReportRowDto>> Handle(GetDailySalesReportQuery request, CancellationToken cancellationToken)
    {
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var (fromUtc, toExclusiveUtc) = ReportDateRange.ToUtcRange(request.FromDate ?? default, request.ToDate ?? default, timeZone);

        byte? source = request.Source.HasValue ? (byte)request.Source.Value : null;

        var orders = await db.Orders
            .AsNoTracking()
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .Include(o => o.OrderBundlePromotions)
            .Where(o => o.CreatedAt >= fromUtc && o.CreatedAt < toExclusiveUtc
                && (source == null || o.Source == source))
            .ToListAsync(cancellationToken);

        var overridePrices = await AddOnPriceLookup.ForOrdersAsync(db, orders, cancellationToken);

        var period = ToPeriod(request.GroupBy ?? ReportGroupByEnum.Day);

        return orders
            .GroupBy(o => ReportPeriods.PeriodStart(o.CreatedAt, period, timeZone))
            .OrderBy(g => g.Key)
            .Select(group =>
            {
                var summary = SalesRules.Summarize(group, overridePrices);

                return new DailySalesReportRowDto(
                    group.Key,
                    summary.Revenue,
                    summary.CompletedOrderCount,
                    summary.AverageOrderValue,
                    summary.Tips,
                    summary.VoidedOrderCount,
                    summary.RefundedOrderCount,
                    summary.RefundedAmount,
                    summary.GrossSales,
                    summary.NetSales,
                    summary.Discounts);
            })
            .ToList();
    }

    private static ReportPeriod ToPeriod(ReportGroupByEnum groupBy) => groupBy switch
    {
        ReportGroupByEnum.Week => ReportPeriod.Week,
        ReportGroupByEnum.Month => ReportPeriod.Month,
        _ => ReportPeriod.Day
    };
}
