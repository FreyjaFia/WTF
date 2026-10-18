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

public sealed record GetCustomersReportQuery : IRequest<List<CustomerReportRowDto>>
{
    public DateTime? FromDate { get; init; }
    public DateTime? ToDate { get; init; }
    public OrderSourceEnum? Source { get; init; }
}

public sealed class GetCustomersReportHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetCustomersReportQuery, List<CustomerReportRowDto>>
{
    public async Task<List<CustomerReportRowDto>> Handle(GetCustomersReportQuery request, CancellationToken cancellationToken)
    {
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var (fromUtc, toExclusiveUtc) = ReportDateRange.ToUtcRange(request.FromDate ?? default, request.ToDate ?? default, timeZone);
        byte? source = request.Source.HasValue ? (byte)request.Source.Value : null;

        var orders = await db.Orders
            .AsNoTracking()
            .Include(o => o.Customer)
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .Include(o => o.OrderBundlePromotions)
            .Where(o =>
                o.CustomerId != null
                && o.CreatedAt >= fromUtc
                && o.CreatedAt < toExclusiveUtc
                && o.StatusId == OrderStatuses.Completed
                && (source == null || o.Source == source))
            .ToReportListAsync(cancellationToken);

        var customerIds = orders.Select(o => o.CustomerId!.Value).Distinct().ToList();

        // First and last sale over all time, so "new" and "last visit" are not limited to the chosen range.
        var history = await db.Orders
            .AsNoTracking()
            .Where(o => o.CustomerId != null && customerIds.Contains(o.CustomerId.Value) && o.StatusId == OrderStatuses.Completed)
            .GroupBy(o => o.CustomerId!.Value)
            .Select(g => new { CustomerId = g.Key, First = g.Min(o => o.CreatedAt), Last = g.Max(o => o.CreatedAt) })
            .ToDictionaryAsync(x => x.CustomerId, cancellationToken);

        var points = await db.LoyaltyPoints
            .AsNoTracking()
            .Where(p => customerIds.Contains(p.CustomerId))
            .GroupBy(p => p.CustomerId)
            .Select(g => new { CustomerId = g.Key, Points = g.Sum(p => p.Points) })
            .ToDictionaryAsync(x => x.CustomerId, x => x.Points, cancellationToken);

        var overridePrices = await AddOnPriceLookup.ForOrdersAsync(db, orders, cancellationToken);

        return orders
            .GroupBy(o => o.CustomerId!.Value)
            .Select(g =>
            {
                var customer = g.First().Customer!;
                var summary = SalesRules.Summarize(g, overridePrices);
                var seen = history[g.Key];

                return new CustomerReportRowDto(
                    g.Key,
                    $"{customer.FirstName} {customer.LastName}".Trim(),
                    summary.CompletedOrderCount,
                    summary.Revenue,
                    summary.AverageOrderValue,
                    ReportPeriods.LocalDateTime(seen.Last, timeZone),
                    ReportRules.IsNewCustomer(seen.First, fromUtc),
                    points.GetValueOrDefault(g.Key));
            })
            .OrderByDescending(r => r.TotalSpent)
            .ToList();
    }
}
