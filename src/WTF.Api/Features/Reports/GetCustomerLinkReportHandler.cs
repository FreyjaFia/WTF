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

public sealed record GetCustomerLinkReportQuery : IRequest<List<CustomerLinkReportRowDto>>
{
    public DateTime? FromDate { get; init; }
    public DateTime? ToDate { get; init; }
}

public sealed class GetCustomerLinkReportHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetCustomerLinkReportQuery, List<CustomerLinkReportRowDto>>
{
    private const int MaxReasonsLength = 200;

    public async Task<List<CustomerLinkReportRowDto>> Handle(GetCustomerLinkReportQuery request, CancellationToken cancellationToken)
    {
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var (fromUtc, toExclusiveUtc) = ReportDateRange.ToUtcRange(request.FromDate ?? default, request.ToDate ?? default, timeZone);
        var linkSource = (byte)OrderSourceEnum.CustomerLink;

        var orders = await db.Orders
            .AsNoTracking()
            .Include(o => o.Customer)
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .Include(o => o.OrderBundlePromotions)
            .Where(o => o.CreatedAt >= fromUtc && o.CreatedAt < toExclusiveUtc && o.Source == linkSource)
            .ToReportListAsync(cancellationToken);

        var overridePrices = await AddOnPriceLookup.ForOrdersAsync(db, orders, cancellationToken);

        return orders
            .GroupBy(o => o.OrderLinkId)
            .Select(g =>
            {
                var customer = g.Select(o => o.Customer).FirstOrDefault(c => c is not null);
                var rejected = g.Where(IsRejected).ToList();
                var reasons = string.Join(
                    "; ",
                    rejected
                        .Select(o => o.RejectionReason!.Trim())
                        .Distinct(StringComparer.OrdinalIgnoreCase));

                return new CustomerLinkReportRowDto(
                    g.Key,
                    customer is null ? "Unknown customer" : $"{customer.FirstName} {customer.LastName}".Trim(),
                    g.Count(),
                    g.Count(o => o.AcceptedAt.HasValue),
                    rejected.Count,
                    g.Count(o => o.StatusId == OrderStatuses.PendingApproval),
                    g.Count(o => o.FulfillmentType == (byte)FulfillmentTypeEnum.Pickup),
                    g.Count(o => o.FulfillmentType == (byte)FulfillmentTypeEnum.Delivery),
                    SalesRules.Summarize(g, overridePrices).Revenue,
                    ReportRules.AverageMinutes(g.Select(o => ReportRules.MinutesBetween(o.CreatedAt, o.AcceptedAt))),
                    ReportRules.AverageMinutes(g.Select(o => ReportRules.MinutesBetween(o.AcceptedAt, o.ReadyAt))),
                    reasons.Length == 0 ? null : reasons.Length > MaxReasonsLength ? reasons[..MaxReasonsLength] : reasons);
            })
            .OrderByDescending(r => r.OrderCount)
            .ToList();
    }

    private static bool IsRejected(Domain.Entities.Order order) =>
        order.StatusId == OrderStatuses.Cancelled
        && !order.AcceptedAt.HasValue
        && !string.IsNullOrWhiteSpace(order.RejectionReason);
}
