using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Time;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports.DTOs;
using WTF.Calculations.Sales;
using WTF.Calculations.Time;
using WTF.Domain.Data;

namespace WTF.Api.Features.Reports;

public sealed record GetProductMarginReportQuery : IRequest<List<ProductMarginReportRowDto>>
{
    public DateTime? FromDate { get; init; }
    public DateTime? ToDate { get; init; }
    public int? CategoryId { get; init; }
    public int? SubCategoryId { get; init; }

    /// <summary>Only orders that came from this source: the shop itself or a customer ordering link. Null means all.</summary>
    public OrderSourceEnum? Source { get; init; }
}

// Profit per product: the revenue of the product sales report (add-ons and bundles on their own rows) against what the sales
// really cost. The cost is read from the stock movements each sale wrote, so it is the cost at the time of the sale and it
// follows the size, the add-ons and the allowance. A product with no stock movements has no cost to show, and the row says so
// instead of counting it as free.
public sealed class GetProductMarginReportHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetProductMarginReportQuery, List<ProductMarginReportRowDto>>
{
    public async Task<List<ProductMarginReportRowDto>> Handle(GetProductMarginReportQuery request, CancellationToken cancellationToken)
    {
        var sales = await new GetProductSalesReportHandler(db, httpContextAccessor).Handle(
            new GetProductSalesReportQuery
            {
                FromDate = request.FromDate,
                ToDate = request.ToDate,
                CategoryId = request.CategoryId,
                SubCategoryId = request.SubCategoryId,
                SplitAddOns = true,
                Source = request.Source
            },
            cancellationToken);
        if (sales.Count == 0)
        {
            return [];
        }

        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var (fromUtc, toExclusiveUtc) = ReportDateRange.ToUtcRange(request.FromDate ?? default, request.ToDate ?? default, timeZone);
        byte? source = request.Source.HasValue ? (byte)request.Source.Value : null;

        var lines = await db.OrderItems
            .AsNoTracking()
            .Where(oi => oi.Order.CreatedAt >= fromUtc
                         && oi.Order.CreatedAt < toExclusiveUtc
                         && (oi.Order.StatusId == OrderStatuses.Completed || oi.Order.StatusId == OrderStatuses.Refunded)
                         && (source == null || oi.Order.Source == source))
            .Select(oi => new LineRow(
                oi.Id,
                oi.OrderId,
                oi.ParentOrderItemId,
                oi.BundlePromotionId,
                oi.ProductId,
                oi.Quantity,
                oi.Order.StatusId == OrderStatuses.Completed,
                oi.Product.SuppliesCost))
            .ToListAsync(cancellationToken);

        var movementRows = await (
                from movement in db.StockMovements.AsNoTracking()
                join order in db.Orders.AsNoTracking() on movement.ReferenceId equals order.Id
                where movement.ReferenceType == StockMovementTypes.OrderReference
                      && movement.ProductId != null
                      && (movement.MovementType == StockMovementTypes.Sale || movement.MovementType == StockMovementTypes.SaleVoid)
                      && order.CreatedAt >= fromUtc
                      && order.CreatedAt < toExclusiveUtc
                      && (order.StatusId == OrderStatuses.Completed || order.StatusId == OrderStatuses.Refunded)
                      && (source == null || order.Source == source)
                select new { OrderId = order.Id, ProductId = movement.ProductId!.Value, movement.QuantityDelta, movement.UnitCost })
            .ToListAsync(cancellationToken);

        // What each product cost in each order. A sale takes stock (negative delta) and a refund gives it back, so
        // minus the delta times the cost at that moment is the net cost. A movement with no cost makes that order's cost unknown.
        var movementCost = movementRows
            .GroupBy(m => (m.OrderId, m.ProductId))
            .ToDictionary(
                group => group.Key,
                group => (
                    Cost: group.Sum(m => -m.QuantityDelta * (m.UnitCost ?? 0m)),
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
        var rows = new Dictionary<Guid, RowAccumulator>();
        var linesByOrderAndProduct = lines.GroupBy(line => (line.OrderId, line.ProductId));

        foreach (var group in linesByOrderAndProduct)
        {
            var groupLines = group.ToList();
            var units = groupLines.Select(line => UnitsOf(line, lineById)).ToList();
            var hasMovements = movementCost.TryGetValue(group.Key, out var moved);
            var shares = hasMovements
                ? ProfitRules.AllocateByUnits(moved.Cost, units)
                : [.. units.Select(_ => 0m)];

            for (var i = 0; i < groupLines.Count; i++)
            {
                var line = groupLines[i];
                var key = RowKeyOf(line, lineById);
                if (!rows.TryGetValue(key, out var row))
                {
                    row = new RowAccumulator();
                    rows[key] = row;
                }

                var costed = hasMovements && !moved.Unpriced;
                var recipeFree = !productsWithRecipe.Contains(line.ProductId) && line.SuppliesCost > 0m;
                row.Cost += shares[i];
                if (line.IsCompleted)
                {
                    row.Cost += line.SuppliesCost * units[i];
                    if (costed || recipeFree)
                    {
                        row.CostedUnits += units[i];
                    }
                    else
                    {
                        row.UncostedUnits += units[i];
                    }
                }
            }
        }

        return [.. sales.Select(sale =>
        {
            rows.TryGetValue(sale.ProductId, out var row);
            row ??= new RowAccumulator();
            var coverage = ProfitRules.Coverage(row.CostedUnits, row.UncostedUnits);
            decimal? cost = coverage == CostCoverage.Unknown ? null : Math.Round(row.Cost, 6, MidpointRounding.AwayFromZero);
            decimal? profit = coverage == CostCoverage.Known && cost.HasValue ? Math.Round(sale.Revenue - cost.Value, 2, MidpointRounding.AwayFromZero) : null;
            return new ProductMarginReportRowDto(
                sale.ProductId,
                sale.ProductName,
                sale.CategoryName,
                sale.SubCategoryName,
                sale.QuantitySold,
                sale.Revenue,
                cost.HasValue ? Math.Round(cost.Value, 2, MidpointRounding.AwayFromZero) : null,
                profit,
                profit.HasValue ? ProfitRules.MarginPercent(sale.Revenue, profit.Value) : null,
                StatusLabel(coverage),
                sale.IsAddOn);
        })
            .OrderByDescending(row => row.GrossProfit ?? decimal.MinValue)
            .ThenByDescending(row => row.Revenue)];
    }

    public static string StatusLabel(CostCoverage coverage) => coverage switch
    {
        CostCoverage.Known => "Known",
        CostCoverage.Partly => "Partly known",
        _ => "No cost"
    };

    // Units of a product on a line: add-ons are per unit of the line they sit on.
    private static decimal UnitsOf(LineRow line, Dictionary<Guid, LineRow> lineById) =>
        line.ParentId.HasValue && lineById.TryGetValue(line.ParentId.Value, out var parent)
            ? (decimal)line.Quantity * parent.Quantity
            : line.Quantity;

    // The row of the report a line belongs to: its own product, or the bundle it was sold in.
    private static Guid RowKeyOf(LineRow line, Dictionary<Guid, LineRow> lineById)
    {
        if (line.BundleId.HasValue)
        {
            return line.BundleId.Value;
        }

        if (line.ParentId.HasValue
            && lineById.TryGetValue(line.ParentId.Value, out var parent)
            && parent.BundleId.HasValue)
        {
            return parent.BundleId.Value;
        }

        return line.ProductId;
    }

    private sealed record LineRow(
        Guid Id,
        Guid OrderId,
        Guid? ParentId,
        Guid? BundleId,
        Guid ProductId,
        int Quantity,
        bool IsCompleted,
        decimal SuppliesCost);

    private sealed class RowAccumulator
    {
        public decimal Cost { get; set; }
        public decimal CostedUnits { get; set; }
        public decimal UncostedUnits { get; set; }
    }
}
