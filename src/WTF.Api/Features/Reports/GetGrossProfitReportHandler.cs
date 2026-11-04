using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Time;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Reports.DTOs;
using WTF.Api.Features.Reports.Enums;
using WTF.Calculations.Sales;
using WTF.Calculations.Time;
using WTF.Domain.Data;

namespace WTF.Api.Features.Reports;

public sealed record GetGrossProfitReportQuery : IRequest<List<GrossProfitReportRowDto>>
{
    public DateTime? FromDate { get; init; }
    public DateTime? ToDate { get; init; }
    public ReportGroupByEnum? GroupBy { get; init; }
}

// Net sales against what they cost, by day, week or month. Theoretical profit takes off the cost the recipes say was used
// (read from the stock movements each sale wrote, as the Product Profit report does). Actual profit also takes off waste and
// the corrections made by counts and adjustments, which are stock paid for and never sold. Waste and corrections are placed
// in the period they were recorded; a sale in the period its order was created.
public sealed class GetGrossProfitReportHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetGrossProfitReportQuery, List<GrossProfitReportRowDto>>
{
    public async Task<List<GrossProfitReportRowDto>> Handle(GetGrossProfitReportQuery request, CancellationToken cancellationToken)
    {
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var (fromUtc, toExclusiveUtc) = ReportDateRange.ToUtcRange(request.FromDate ?? default, request.ToDate ?? default, timeZone);
        var groupBy = request.GroupBy ?? ReportGroupByEnum.Day;
        var period = ToPeriod(groupBy);

        var sales = await new GetDailySalesReportHandler(db, httpContextAccessor).Handle(
            new GetDailySalesReportQuery { FromDate = request.FromDate, ToDate = request.ToDate, GroupBy = groupBy },
            cancellationToken);

        var periods = new Dictionary<DateTime, PeriodAccumulator>();
        PeriodAccumulator For(DateTime utc)
        {
            var key = ReportPeriods.PeriodStart(utc, period, timeZone);
            if (!periods.TryGetValue(key, out var accumulator))
            {
                accumulator = new PeriodAccumulator();
                periods[key] = accumulator;
            }

            return accumulator;
        }

        foreach (var sale in sales)
        {
            if (!periods.TryGetValue(sale.PeriodStart, out var accumulator))
            {
                accumulator = new PeriodAccumulator();
                periods[sale.PeriodStart] = accumulator;
            }

            accumulator.NetSales = sale.NetSales;
        }

        await AddSaleCostsAsync(fromUtc, toExclusiveUtc, For, cancellationToken);

        var losses = await db.StockMovements
            .AsNoTracking()
            .Where(m => m.CreatedAt >= fromUtc
                        && m.CreatedAt < toExclusiveUtc
                        && (m.MovementType == StockMovementTypes.Waste
                            || m.MovementType == StockMovementTypes.WasteReversed
                            || m.MovementType == StockMovementTypes.Count
                            || m.MovementType == StockMovementTypes.Adjustment))
            .Select(m => new { m.MovementType, m.QuantityDelta, m.UnitCost, m.CreatedAt })
            .ToReportListAsync(cancellationToken);

        foreach (var movement in losses)
        {
            var accumulator = For(movement.CreatedAt);
            var isWaste = movement.MovementType is StockMovementTypes.Waste or StockMovementTypes.WasteReversed;
            if (movement.UnitCost is null)
            {
                accumulator.UnpricedLoss = true;
                continue;
            }

            var cost = ProfitRules.MovementCost(movement.QuantityDelta, movement.UnitCost.Value);
            if (isWaste)
            {
                accumulator.Waste += cost;
            }
            else
            {
                accumulator.CountVariance += cost;
            }
        }

        return [.. periods
            .OrderBy(entry => entry.Key)
            .Select(entry =>
            {
                var accumulator = entry.Value;
                var coverage = ProfitRules.Coverage(accumulator.CostedUnits, accumulator.UncostedUnits);
                var cost = Math.Round(accumulator.Cost, 2, MidpointRounding.AwayFromZero);
                var waste = Math.Round(accumulator.Waste, 2, MidpointRounding.AwayFromZero);
                var variance = Math.Round(accumulator.CountVariance, 2, MidpointRounding.AwayFromZero);
                var summary = ProfitRules.GrossProfit(accumulator.NetSales, cost, waste, variance);
                var known = coverage != CostCoverage.Unknown;

                return new GrossProfitReportRowDto(
                    entry.Key,
                    accumulator.NetSales,
                    cost,
                    known ? summary.TheoreticalProfit : null,
                    waste,
                    variance,
                    known ? summary.ActualProfit : null,
                    known ? summary.MarginPercent : null,
                    ProfitRules.CostStatus(coverage, accumulator.UnpricedLoss));
            })];
    }

    // The cost of the sales in each period. The same reading as the Product Profit report: the cost is minus the quantity of
    // the order's Sale and SaleVoid movements times the cost they carry, plus the supplies cost of each unit sold. A product
    // that took no stock and has no supplies cost is counted as uncosted, never as free.
    private async Task AddSaleCostsAsync(
        DateTime fromUtc,
        DateTime toExclusiveUtc,
        Func<DateTime, PeriodAccumulator> periodOf,
        CancellationToken cancellationToken)
    {
        var lines = await db.OrderItems
            .AsNoTracking()
            .Where(oi => oi.Order.CreatedAt >= fromUtc
                         && oi.Order.CreatedAt < toExclusiveUtc
                         && oi.Order.StatusId == OrderStatuses.Completed)
            .Select(oi => new LineRow(oi.Id, oi.OrderId, oi.ParentOrderItemId, oi.ProductId, oi.Quantity, oi.Order.CreatedAt, oi.Product.SuppliesCost))
            .ToReportListAsync(cancellationToken);

        var movements = await (
                from movement in db.StockMovements.AsNoTracking()
                join order in db.Orders.AsNoTracking() on movement.ReferenceId equals order.Id
                where movement.ReferenceType == StockMovementTypes.OrderReference
                      && movement.ProductId != null
                      && (movement.MovementType == StockMovementTypes.Sale || movement.MovementType == StockMovementTypes.SaleVoid)
                      && order.CreatedAt >= fromUtc
                      && order.CreatedAt < toExclusiveUtc
                      && (order.StatusId == OrderStatuses.Completed || order.StatusId == OrderStatuses.Refunded)
                select new { OrderId = order.Id, order.CreatedAt, order.StatusId, ProductId = movement.ProductId!.Value, movement.QuantityDelta, movement.UnitCost })
            .ToReportListAsync(cancellationToken);

        // A refunded order sold nothing, but its movements still net what it took against what came back; any cost that
        // stays (made drinks not returned) is carried by the waste entry the refund wrote.
        foreach (var refunded in movements.Where(m => m.StatusId == OrderStatuses.Refunded))
        {
            if (refunded.UnitCost is { } cost)
            {
                periodOf(refunded.CreatedAt).Cost += ProfitRules.MovementCost(refunded.QuantityDelta, cost);
            }
            else
            {
                periodOf(refunded.CreatedAt).UnpricedLoss = true;
            }
        }

        var completedMovements = movements
            .Where(m => m.StatusId == OrderStatuses.Completed)
            .GroupBy(m => (m.OrderId, m.ProductId))
            .ToDictionary(
                group => group.Key,
                group => (
                    Cost: group.Sum(m => ProfitRules.MovementCost(m.QuantityDelta, m.UnitCost ?? 0m)),
                    Unpriced: group.Any(m => m.UnitCost is null)));

        var productIds = lines.Select(line => line.ProductId).Distinct().ToList();
        var productsWithRecipe = (await db.ProductItemLinks
                .AsNoTracking()
                .Where(link => link.IsActive && productIds.Contains(link.ProductId))
                .Select(link => link.ProductId)
                .Distinct()
                .ToListAsync(cancellationToken))
            .ToHashSet();

        var lineById = lines.ToDictionary(line => line.Id);
        foreach (var group in lines.GroupBy(line => (line.OrderId, line.ProductId)))
        {
            var hasMovements = completedMovements.TryGetValue(group.Key, out var moved);
            var costed = hasMovements && !moved.Unpriced;
            foreach (var line in group)
            {
                var units = line.ParentId.HasValue && lineById.TryGetValue(line.ParentId.Value, out var parent)
                    ? (decimal)line.Quantity * parent.Quantity
                    : line.Quantity;
                var accumulator = periodOf(line.CreatedAt);
                var recipeFree = !productsWithRecipe.Contains(line.ProductId) && line.SuppliesCost > 0m;

                accumulator.Cost += line.SuppliesCost * units;
                if (costed || recipeFree)
                {
                    accumulator.CostedUnits += units;
                }
                else
                {
                    accumulator.UncostedUnits += units;
                }
            }

            if (hasMovements)
            {
                periodOf(group.First().CreatedAt).Cost += moved.Cost;
            }
        }
    }

    private static ReportPeriod ToPeriod(ReportGroupByEnum groupBy) => groupBy switch
    {
        ReportGroupByEnum.Week => ReportPeriod.Week,
        ReportGroupByEnum.Month => ReportPeriod.Month,
        _ => ReportPeriod.Day
    };

    private sealed record LineRow(
        Guid Id,
        Guid OrderId,
        Guid? ParentId,
        Guid ProductId,
        int Quantity,
        DateTime CreatedAt,
        decimal SuppliesCost);

    private sealed class PeriodAccumulator
    {
        public decimal NetSales { get; set; }
        public decimal Cost { get; set; }
        public decimal Waste { get; set; }
        public decimal CountVariance { get; set; }
        public decimal CostedUnits { get; set; }
        public decimal UncostedUnits { get; set; }
        public bool UnpricedLoss { get; set; }
    }
}
