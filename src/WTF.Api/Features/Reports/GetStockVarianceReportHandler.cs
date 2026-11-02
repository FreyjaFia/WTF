using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Time;
using WTF.Api.Features.Reports.DTOs;
using WTF.Calculations.Inventory;
using WTF.Calculations.Time;
using WTF.Domain.Data;

namespace WTF.Api.Features.Reports;

public sealed record GetStockVarianceReportQuery : IRequest<List<StockVarianceReportRowDto>>
{
    public DateTime? FromDate { get; init; }
    public DateTime? ToDate { get; init; }
    public Guid? ItemId { get; init; }
    public decimal? TolerancePercent { get; init; }
}

public sealed class GetStockVarianceReportHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetStockVarianceReportQuery, List<StockVarianceReportRowDto>>
{
    public const decimal DefaultTolerancePercent = 5m;

    public async Task<List<StockVarianceReportRowDto>> Handle(GetStockVarianceReportQuery request, CancellationToken cancellationToken)
    {
        var tolerance = request.TolerancePercent ?? DefaultTolerancePercent;
        if (tolerance < 0m || tolerance > 100m)
        {
            throw new InvalidOperationException("tolerancePercent must be between 0 and 100.");
        }

        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var (fromUtc, toExclusiveUtc) = ReportDateRange.ToUtcRange(request.FromDate ?? default, request.ToDate ?? default, timeZone);

        var movements = await db.StockMovements
            .AsNoTracking()
            .Where(m =>
                m.CreatedAt >= fromUtc
                && m.CreatedAt < toExclusiveUtc
                && m.Item.IsActive
                && (request.ItemId == null || m.ItemId == request.ItemId))
            .Select(m => new
            {
                m.ItemId,
                ItemName = m.Item.Name,
                m.Item.UnitName,
                m.MovementType,
                m.QuantityDelta,
                m.QuantityBefore,
                m.QuantityAfter,
                m.UnitCost,
                m.CreatedAt
            })
            .ToReportListAsync(cancellationToken);

        return movements
            .GroupBy(m => m.ItemId)
            .Select(group =>
            {
                var ordered = group.OrderBy(m => m.CreatedAt).ToList();
                var summary = VarianceRules.Summarize(
                    ordered.Select(m => new VarianceMovement(m.MovementType, m.QuantityDelta, m.UnitCost)));

                return new StockVarianceReportRowDto(
                    group.Key,
                    ordered[0].ItemName,
                    ordered[0].UnitName,
                    ordered[0].QuantityBefore,
                    summary.Received,
                    summary.TheoreticalUsage,
                    summary.Waste,
                    summary.Corrections,
                    summary.ActualUsage,
                    ordered[^1].QuantityAfter,
                    summary.Variance,
                    summary.VariancePercent,
                    summary.VarianceValue,
                    VarianceRules.Status(summary, tolerance));
            })
            .OrderByDescending(r => Math.Abs(r.VarianceValue ?? r.Variance))
            .ThenBy(r => r.ItemName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }
}
