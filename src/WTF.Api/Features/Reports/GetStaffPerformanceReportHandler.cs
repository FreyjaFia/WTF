using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Time;
using WTF.Api.Features.OrderLinks;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports.DTOs;
using WTF.Calculations.Sales;
using WTF.Calculations.Time;
using WTF.Domain.Data;

namespace WTF.Api.Features.Reports;

public sealed record GetStaffPerformanceReportQuery : IRequest<List<StaffPerformanceReportRowDto>>
{
    public DateTime? FromDate { get; init; }
    public DateTime? ToDate { get; init; }
    public Guid? StaffId { get; init; }
    /// <summary>Only orders that came from this source: the shop itself or a customer ordering link. Null means all.</summary>
    public OrderSourceEnum? Source { get; init; }
}

public sealed class GetStaffPerformanceReportHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetStaffPerformanceReportQuery, List<StaffPerformanceReportRowDto>>
{
    /// <summary>Customer link orders are saved under a system user, so the report names that row for what it is.</summary>
    public const string CustomerLinkLabel = "Customer link (online)";

    public async Task<List<StaffPerformanceReportRowDto>> Handle(GetStaffPerformanceReportQuery request, CancellationToken cancellationToken)
    {
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var (fromUtc, toExclusiveUtc) = ReportDateRange.ToUtcRange(request.FromDate ?? default, request.ToDate ?? default, timeZone);

        byte? source = request.Source.HasValue ? (byte)request.Source.Value : null;

        var query = db.Orders
            .AsNoTracking()
            .Include(o => o.CreatedByNavigation)
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .Include(o => o.OrderBundlePromotions)
            .Where(o =>
                o.CreatedAt >= fromUtc
                && o.CreatedAt < toExclusiveUtc
                && (o.StatusId == OrderStatuses.Completed || o.StatusId == OrderStatuses.Refunded)
                && (source == null || o.Source == source));

        if (request.StaffId.HasValue)
        {
            query = query.Where(o => o.CreatedBy == request.StaffId.Value);
        }

        var orders = await query.ToListAsync(cancellationToken);
        var overridePrices = await AddOnPriceLookup.ForOrdersAsync(db, orders, cancellationToken);

        var grouped = orders
            .GroupBy(o => new
            {
                o.CreatedBy,
                o.CreatedByNavigation.FirstName,
                o.CreatedByNavigation.LastName,
                o.CreatedByNavigation.Username
            })
            .Select(g => new
            {
                StaffId = g.Key.CreatedBy,
                StaffName = g.Key.Username == SubmitPublicOrderHandler.SystemUsername
                    ? CustomerLinkLabel
                    : $"{g.Key.FirstName} {g.Key.LastName}".Trim(),
                Summary = SalesRules.Summarize(g, overridePrices)
            })
            .OrderByDescending(r => r.Summary.Revenue)
            .ToList();

        return grouped
            .Select(row => new StaffPerformanceReportRowDto(
                row.StaffId,
                row.StaffName,
                row.Summary.CompletedOrderCount,
                row.Summary.Revenue,
                row.Summary.AverageOrderValue,
                row.Summary.Tips,
                row.Summary.GrossSales,
                row.Summary.Discounts,
                row.Summary.RefundedAmount))
            .ToList();
    }
}
