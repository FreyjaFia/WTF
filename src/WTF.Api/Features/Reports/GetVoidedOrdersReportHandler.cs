using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Time;
using WTF.Api.Features.OrderLinks;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports.DTOs;
using WTF.Calculations.Orders;
using WTF.Calculations.Sales;
using WTF.Calculations.Time;
using WTF.Domain.Data;

namespace WTF.Api.Features.Reports;

public sealed record GetVoidedOrdersReportQuery : IRequest<List<VoidedOrderReportRowDto>>
{
    public DateTime? FromDate { get; init; }
    public DateTime? ToDate { get; init; }
    public OrderSourceEnum? Source { get; init; }
}

public sealed class GetVoidedOrdersReportHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetVoidedOrdersReportQuery, List<VoidedOrderReportRowDto>>
{
    public async Task<List<VoidedOrderReportRowDto>> Handle(GetVoidedOrdersReportQuery request, CancellationToken cancellationToken)
    {
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var (fromUtc, toExclusiveUtc) = ReportDateRange.ToUtcRange(request.FromDate ?? default, request.ToDate ?? default, timeZone);
        byte? source = request.Source.HasValue ? (byte)request.Source.Value : null;

        var finished = db.Orders
            .AsNoTracking()
            .Where(o =>
                o.CreatedAt >= fromUtc
                && o.CreatedAt < toExclusiveUtc
                && (o.StatusId == OrderStatuses.Completed || o.StatusId == OrderStatuses.Cancelled || o.StatusId == OrderStatuses.Refunded)
                && (source == null || o.Source == source));

        var voided = await finished
            .Where(o => o.StatusId == OrderStatuses.Cancelled || o.StatusId == OrderStatuses.Refunded)
            .Include(o => o.CreatedByNavigation)
            .Include(o => o.UpdatedByNavigation)
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .Include(o => o.OrderBundlePromotions)
            .ToReportListAsync(cancellationToken);

        var finishedPerStaff = await finished
            .GroupBy(o => o.CreatedBy)
            .Select(g => new { StaffId = g.Key, Total = g.Count() })
            .ToDictionaryAsync(x => x.StaffId, x => x.Total, cancellationToken);

        var voidedPerStaff = voided
            .GroupBy(o => o.CreatedBy)
            .ToDictionary(g => g.Key, g => g.Count());

        var overridePrices = await AddOnPriceLookup.ForOrdersAsync(db, voided, cancellationToken);

        return voided
            .OrderByDescending(o => o.UpdatedAt ?? o.CreatedAt)
            .Select(o => new VoidedOrderReportRowDto(
                o.Id,
                o.OrderNumber,
                ReportPeriods.LocalDateTime(o.CreatedAt, timeZone),
                o.UpdatedAt.HasValue ? ReportPeriods.LocalDateTime(o.UpdatedAt.Value, timeZone) : null,
                VoidedOrderKinds.For(o),
                StaffName(o),
                VoidedOrderKinds.VoidedByName(o),
                OrderMetrics.ComputeOrderTotal(o, overridePrices),
                VoidedOrderKinds.ReasonFor(o),
                SalesRules.VoidRate(voidedPerStaff[o.CreatedBy], finishedPerStaff.GetValueOrDefault(o.CreatedBy))))
            .ToList();
    }

    private static string StaffName(Domain.Entities.Order order) =>
        order.CreatedByNavigation.Username == SubmitPublicOrderHandler.SystemUsername
            ? GetStaffPerformanceReportHandler.CustomerLinkLabel
            : $"{order.CreatedByNavigation.FirstName} {order.CreatedByNavigation.LastName}".Trim();
}
