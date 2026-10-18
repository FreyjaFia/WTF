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

public sealed record GetPromotionPerformanceReportQuery : IRequest<List<PromotionPerformanceReportRowDto>>
{
    public DateTime? FromDate { get; init; }
    public DateTime? ToDate { get; init; }
    public OrderSourceEnum? Source { get; init; }
}

public sealed class GetPromotionPerformanceReportHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetPromotionPerformanceReportQuery, List<PromotionPerformanceReportRowDto>>
{
    public const string DiscountedProductType = "Discounted Product";
    private const int FixedBundlePromotionTypeId = 1;
    private const int MixMatchPromotionTypeId = 2;

    public async Task<List<PromotionPerformanceReportRowDto>> Handle(GetPromotionPerformanceReportQuery request, CancellationToken cancellationToken)
    {
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var (fromUtc, toExclusiveUtc) = ReportDateRange.ToUtcRange(request.FromDate ?? default, request.ToDate ?? default, timeZone);
        byte? source = request.Source.HasValue ? (byte)request.Source.Value : null;

        var discountedLines = await db.OrderItems
            .AsNoTracking()
            .Where(oi =>
                oi.ParentOrderItemId == null
                && oi.BundlePromotionId == null
                && oi.PromoLabel != null
                && oi.Order.CreatedAt >= fromUtc
                && oi.Order.CreatedAt < toExclusiveUtc
                && oi.Order.StatusId == OrderStatuses.Completed
                && (source == null || oi.Order.Source == source))
            .Select(oi => new { oi.PromoLabel, oi.Quantity, oi.Price, oi.OriginalPrice })
            .ToReportListAsync(cancellationToken);

        var rows = discountedLines
            .GroupBy(line => line.PromoLabel!)
            .Select(g => new PromotionPerformanceReportRowDto(
                g.Key,
                DiscountedProductType,
                g.Sum(line => line.Quantity),
                g.Sum(line => (line.Price ?? 0m) * line.Quantity),
                g.Sum(line => ReportRules.DiscountGiven(line.OriginalPrice ?? line.Price ?? 0m, line.Price ?? 0m, line.Quantity))))
            .ToList();

        var bundles = await db.OrderBundlePromotions
            .AsNoTracking()
            .Where(obp =>
                obp.Order.CreatedAt >= fromUtc
                && obp.Order.CreatedAt < toExclusiveUtc
                && obp.Order.StatusId == OrderStatuses.Completed
                && (source == null || obp.Order.Source == source)
                && (obp.Promotion.TypeId == FixedBundlePromotionTypeId || obp.Promotion.TypeId == MixMatchPromotionTypeId))
            .GroupBy(obp => new { obp.PromotionId, obp.Promotion.Name, obp.Promotion.TypeId })
            .Select(g => new
            {
                g.Key.Name,
                g.Key.TypeId,
                Uses = g.Sum(x => x.Quantity),
                Revenue = g.Sum(x => x.UnitPrice * x.Quantity)
            })
            .ToReportListAsync(cancellationToken);

        rows.AddRange(bundles.Select(b => new PromotionPerformanceReportRowDto(
            b.Name,
            b.TypeId == MixMatchPromotionTypeId ? "Mix & Match" : "Fixed Bundle",
            b.Uses,
            b.Revenue,
            null)));

        return rows.OrderByDescending(r => r.Revenue).ToList();
    }
}
