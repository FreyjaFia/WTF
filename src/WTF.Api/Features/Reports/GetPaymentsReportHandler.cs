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

public sealed record GetPaymentsReportQuery : IRequest<List<PaymentsReportRowDto>>
{
    public DateTime? FromDate { get; init; }
    public DateTime? ToDate { get; init; }
    /// <summary>Only orders that came from this source: the shop itself or a customer ordering link. Null means all.</summary>
    public OrderSourceEnum? Source { get; init; }
}

public sealed class GetPaymentsReportHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetPaymentsReportQuery, List<PaymentsReportRowDto>>
{
    public async Task<List<PaymentsReportRowDto>> Handle(GetPaymentsReportQuery request, CancellationToken cancellationToken)
    {
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var (fromUtc, toExclusiveUtc) = ReportDateRange.ToUtcRange(request.FromDate ?? default, request.ToDate ?? default, timeZone);

        byte? source = request.Source.HasValue ? (byte)request.Source.Value : null;

        var orders = await db.Orders
            .AsNoTracking()
            .Include(o => o.PaymentMethod)
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .Include(o => o.OrderBundlePromotions)
            .Where(o =>
                o.CreatedAt >= fromUtc
                && o.CreatedAt < toExclusiveUtc
                && (o.StatusId == OrderStatuses.Completed || o.StatusId == OrderStatuses.Refunded)
                && (source == null || o.Source == source))
            .ToReportListAsync(cancellationToken);

        var overridePrices = await AddOnPriceLookup.ForOrdersAsync(db, orders, cancellationToken);

        var grouped = orders
            .GroupBy(o => o.PaymentMethod != null ? o.PaymentMethod.Name : "Unknown")
            .Select(g => new
            {
                PaymentMethod = g.Key,
                Summary = SalesRules.Summarize(g, overridePrices)
            })
            .OrderByDescending(r => r.Summary.Revenue)
            .ToList();

        var grandTotal = grouped.Sum(g => g.Summary.Revenue);

        return grouped
            .Select(row => new PaymentsReportRowDto(
                row.PaymentMethod,
                row.Summary.CompletedOrderCount,
                row.Summary.Revenue,
                SalesRules.PercentOfTotal(row.Summary.Revenue, grandTotal),
                row.Summary.GrossSales,
                row.Summary.Discounts,
                row.Summary.RefundedAmount,
                row.Summary.Tips))
            .ToList();
    }
}
