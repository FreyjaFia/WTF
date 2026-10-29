using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Time;
using WTF.Api.Features.Inventory.Waste;
using WTF.Api.Features.OrderLinks;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports.DTOs;
using WTF.Calculations.Inventory;
using WTF.Calculations.Orders;
using WTF.Calculations.Sales;
using WTF.Calculations.Time;
using WTF.Domain.Data;

namespace WTF.Api.Features.Reports;

public sealed record GetDailyCloseReportQuery : IRequest<List<DailyCloseReportRowDto>>
{
    public DateTime? FromDate { get; init; }
    public DateTime? ToDate { get; init; }
    public OrderSourceEnum? Source { get; init; }
}

public sealed class GetDailyCloseReportHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetDailyCloseReportQuery, List<DailyCloseReportRowDto>>
{
    public const string SalesSection = "Sales";
    public const string PaymentsSection = "Payments";
    public const string StaffSection = "Staff";
    public const string VoidsSection = "Voids";
    public const string WasteSection = "Waste";

    public async Task<List<DailyCloseReportRowDto>> Handle(GetDailyCloseReportQuery request, CancellationToken cancellationToken)
    {
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var (fromUtc, toExclusiveUtc) = ReportDateRange.ToUtcRange(request.FromDate ?? default, request.ToDate ?? default, timeZone);
        byte? source = request.Source.HasValue ? (byte)request.Source.Value : null;

        var orders = await db.Orders
            .AsNoTracking()
            .Include(o => o.CreatedByNavigation)
            .Include(o => o.UpdatedByNavigation)
            .Include(o => o.PaymentMethod)
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .Include(o => o.OrderBundlePromotions)
            .Where(o =>
                o.CreatedAt >= fromUtc
                && o.CreatedAt < toExclusiveUtc
                && !OrderStatuses.Unconfirmed.Contains(o.StatusId)
                && (source == null || o.Source == source))
            .ToReportListAsync(cancellationToken);

        var overridePrices = await AddOnPriceLookup.ForOrdersAsync(db, orders, cancellationToken);
        var summary = SalesRules.Summarize(orders, overridePrices);
        var cancelledCount = summary.VoidedOrderCount - summary.RefundedOrderCount;
        var sales = orders.Where(o => SalesRules.IsSale(o.StatusId)).ToList();

        var rows = new List<DailyCloseReportRowDto>
        {
            new(SalesSection, "Gross sales", "Sold, including what was later refunded", summary.CompletedOrderCount + summary.RefundedOrderCount, summary.GrossSales),
            new(SalesSection, "Refunds", "Taken off gross sales", summary.RefundedOrderCount, summary.RefundedAmount),
            new(SalesSection, "Net sales", "Completed orders", summary.CompletedOrderCount, summary.NetSales),
            new(SalesSection, "Average order", null, summary.CompletedOrderCount, summary.AverageOrderValue),
            new(SalesSection, "Tips", null, summary.CompletedOrderCount, summary.Tips),
            new(SalesSection, "Cancelled orders", "Never paid, so no amount", cancelledCount, 0m)
        };

        rows.AddRange(sales
            .GroupBy(o => o.PaymentMethod?.Name ?? "Unknown")
            .OrderBy(g => g.Key)
            .Select(g =>
            {
                var paymentSummary = SalesRules.Summarize(g, overridePrices);
                return new DailyCloseReportRowDto(
                    PaymentsSection,
                    g.Key,
                    $"Tips PHP {paymentSummary.Tips:N2}",
                    paymentSummary.CompletedOrderCount,
                    paymentSummary.Revenue);
            }));

        rows.AddRange(sales
            .GroupBy(o => o.CreatedBy)
            .Select(g =>
            {
                var staff = g.First().CreatedByNavigation;
                var name = staff.Username == SubmitPublicOrderHandler.SystemUsername
                    ? GetStaffPerformanceReportHandler.CustomerLinkLabel
                    : $"{staff.FirstName} {staff.LastName}".Trim();
                var staffSummary = SalesRules.Summarize(g, overridePrices);
                return new DailyCloseReportRowDto(
                    StaffSection,
                    name,
                    $"Tips PHP {staffSummary.Tips:N2}",
                    staffSummary.CompletedOrderCount,
                    staffSummary.Revenue);
            })
            .OrderBy(r => r.Label));

        rows.AddRange(orders
            .Where(o => SalesRules.IsVoided(o.StatusId))
            .OrderBy(o => o.OrderNumber)
            .Select(o =>
            {
                var kind = VoidedOrderKinds.For(o);
                var reason = VoidedOrderKinds.ReasonFor(o);
                var by = VoidedOrderKinds.VoidedByName(o);
                var detail = string.Join(" | ", new[] { reason, by is null ? null : $"by {by}" }.Where(x => !string.IsNullOrWhiteSpace(x)));
                return new DailyCloseReportRowDto(
                    VoidsSection,
                    $"Order #{o.OrderNumber} ({kind})",
                    detail.Length == 0 ? null : detail,
                    1,
                    OrderMetrics.ComputeOrderTotal(o, overridePrices));
            }));

        if (source == null)
        {
            var wastes = await db.StockWastes
                .AsNoTracking()
                .Where(w =>
                    w.CreatedAt >= fromUtc
                    && w.CreatedAt < toExclusiveUtc
                    && w.Status != StockWasteStatuses.Reversed)
                .Select(w => new { w.ItemId, ItemName = w.Item.Name, w.Item.UnitName, w.Quantity, w.Status })
                .ToListAsync(cancellationToken);

            rows.AddRange(wastes
                .GroupBy(w => w.ItemId)
                .Select(g =>
                {
                    var unitName = g.First().UnitName;
                    var summary = WasteRules.Summarize(g.Select(w =>
                        new WasteEntry(w.Quantity, unitName, w.Status == StockWasteStatuses.Disputed)));
                    var detail = $"{summary.EntryCount} {(summary.EntryCount == 1 ? "entry" : "entries")}, "
                        + StockWasteMapping.FormatQuantity(summary.Quantity, unitName);

                    if (summary.DisputedCount > 0)
                    {
                        detail += $" ({summary.DisputedCount} disputed, "
                            + $"{StockWasteMapping.FormatQuantity(summary.DisputedQuantity, unitName)})";
                    }

                    return new DailyCloseReportRowDto(
                        WasteSection,
                        g.First().ItemName,
                        detail,
                        summary.EntryCount,
                        0m,
                        summary.Quantity,
                        unitName,
                        summary.DisputedCount,
                        summary.DisputedQuantity);
                })
                .OrderBy(r => r.Label));
        }

        return rows;
    }
}
