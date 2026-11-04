using MediatR;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports.DTOs;
using WTF.Calculations.Sales;
using WTF.Domain.Data;

namespace WTF.Api.Features.Reports;

public sealed record GetMenuEngineeringReportQuery : IRequest<List<MenuEngineeringReportRowDto>>
{
    public DateTime? FromDate { get; init; }
    public DateTime? ToDate { get; init; }
    public int? CategoryId { get; init; }
    public int? SubCategoryId { get; init; }
    public OrderSourceEnum? Source { get; init; }
}

// Sorts the menu into Stars, Plowhorses, Puzzles and Dogs from the Product Profit report. Only products whose cost is fully
// known are rated: a product with a missing cost would look more profitable than it is. Add-ons and bundles are not menu
// items and are left out.
public sealed class GetMenuEngineeringReportHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetMenuEngineeringReportQuery, List<MenuEngineeringReportRowDto>>
{
    public const string NotRated = "Not rated";
    private const string BundleCategoryName = "Promotions";

    public async Task<List<MenuEngineeringReportRowDto>> Handle(GetMenuEngineeringReportQuery request, CancellationToken cancellationToken)
    {
        var margins = await new GetProductMarginReportHandler(db, httpContextAccessor).Handle(
            new GetProductMarginReportQuery
            {
                FromDate = request.FromDate,
                ToDate = request.ToDate,
                CategoryId = request.CategoryId,
                SubCategoryId = request.SubCategoryId,
                Source = request.Source
            },
            cancellationToken);

        var menu = margins
            .Where(row => !row.IsAddOn && row.CategoryName != BundleCategoryName)
            .ToList();

        var ratings = MenuEngineeringRules
            .Rate([.. menu
                .Where(row => row.GrossProfit.HasValue && row.QuantitySold > 0)
                .Select(row => new MenuItemSales(row.ProductId, row.QuantitySold, row.GrossProfit!.Value))])
            .ToDictionary(rating => rating.Key);

        return [.. menu
            .Select(row =>
            {
                ratings.TryGetValue(row.ProductId, out var rating);
                return new MenuEngineeringReportRowDto(
                    row.ProductId,
                    row.ProductName,
                    row.CategoryName,
                    row.QuantitySold,
                    row.Revenue,
                    row.GrossProfit,
                    rating?.UnitProfit,
                    rating?.PopularityPercent,
                    rating?.MenuClass ?? NotRated,
                    row.CostStatus);
            })
            .OrderBy(row => ClassOrder(row.MenuClass))
            .ThenByDescending(row => row.GrossProfit ?? decimal.MinValue)
            .ThenBy(row => row.ProductName, StringComparer.OrdinalIgnoreCase)];
    }

    private static int ClassOrder(string menuClass) => menuClass switch
    {
        MenuEngineeringRules.Star => 0,
        MenuEngineeringRules.Plowhorse => 1,
        MenuEngineeringRules.Puzzle => 2,
        MenuEngineeringRules.Dog => 3,
        _ => 4
    };
}
