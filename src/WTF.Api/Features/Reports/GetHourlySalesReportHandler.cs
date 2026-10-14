using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Time;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports.DTOs;
using WTF.Calculations.Sales;
using WTF.Calculations.Time;
using WTF.Domain.Data;

namespace WTF.Api.Features.Reports;

public sealed record GetHourlySalesReportQuery : IRequest<List<HourlySalesReportRowDto>>
{
    public DateTime? FromDate { get; init; }
    public DateTime? ToDate { get; init; }
    /// <summary>Only orders that came from this source: the shop itself or a customer ordering link. Null means all.</summary>
    public OrderSourceEnum? Source { get; init; }
}

public sealed class GetHourlySalesReportHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetHourlySalesReportQuery, List<HourlySalesReportRowDto>>
{
    public async Task<List<HourlySalesReportRowDto>> Handle(GetHourlySalesReportQuery request, CancellationToken cancellationToken)
    {
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var (fromUtc, toExclusiveUtc) = ReportDateRange.ToUtcRange(request.FromDate ?? default, request.ToDate ?? default, timeZone);

        byte? source = request.Source.HasValue ? (byte)request.Source.Value : null;

        var orders = await db.Orders
            .AsNoTracking()
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .Include(o => o.OrderBundlePromotions)
            .Where(o =>
                o.CreatedAt >= fromUtc
                && o.CreatedAt < toExclusiveUtc
                && o.StatusId == OrderStatuses.Completed
                && (source == null || o.Source == source))
            .ToListAsync(cancellationToken);

        var overridePrices = await AddOnPriceLookup.ForOrdersAsync(db, orders, cancellationToken);

        var grouped = orders
            .GroupBy(o => ReportPeriods.LocalHour(o.CreatedAt, timeZone))
            .Select(g => new
            {
                Hour = g.Key,
                Summary = SalesRules.Summarize(g, overridePrices)
            })
            .ToList();

        var byHour = grouped.ToDictionary(g => g.Hour, g => g);

        return Enumerable.Range(0, 24)
            .Select(hour =>
            {
                byHour.TryGetValue(hour, out var row);
                return new HourlySalesReportRowDto(
                    hour,
                    row?.Summary.CompletedOrderCount ?? 0,
                    row?.Summary.Revenue ?? 0m);
            })
            .ToList();
    }
}
