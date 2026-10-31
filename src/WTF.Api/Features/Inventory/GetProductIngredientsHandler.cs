using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Inventory.DTOs;
using WTF.Calculations.Inventory;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory;

public record GetProductIngredientsQuery(bool IncludeCosts) : IRequest<ProductIngredientsDto>;

// One row per product for the Ingredients & Cost page: whether it takes stock (the coverage rule), how many ingredients it
// has and, for the cost roles, what a sale costs and the margin. A product with no ingredient and no supplies cost has no
// cost at all, not a free one.
public class GetProductIngredientsHandler(WTFDbContext db) : IRequestHandler<GetProductIngredientsQuery, ProductIngredientsDto>
{
    public async Task<ProductIngredientsDto> Handle(GetProductIngredientsQuery request, CancellationToken cancellationToken)
    {
        var coverage = await new GetStockCoverageHandler(db).Handle(new GetStockCoverageQuery(), cancellationToken);
        var productIds = coverage.Products.Select(p => p.ProductId).ToList();

        var prices = await db.Products
            .AsNoTracking()
            .Where(p => productIds.Contains(p.Id))
            .Select(p => new { p.Id, p.Price, p.SuppliesCost, SubCategoryName = p.SubCategory != null ? p.SubCategory.Name : null })
            .ToDictionaryAsync(p => p.Id, cancellationToken);

        var links = (await db.ProductItemLinks
            .AsNoTracking()
            .Where(l => productIds.Contains(l.ProductId) && l.IsActive && l.Item.IsActive)
            .Select(l => new { l.ProductId, l.QuantityPerSale, l.AllowancePercent, l.Item.AverageCost, l.Item.CostPrice, l.Item.YieldPercent })
            .ToListAsync(cancellationToken))
            .ToLookup(l => l.ProductId);

        var rows = coverage.Products
            .Select(product =>
            {
                var price = prices[product.ProductId];
                var productLinks = links[product.ProductId].ToList();
                decimal? cost = null;
                var unknown = 0;
                decimal? margin = null;
                decimal? marginPercent = null;

                if (request.IncludeCosts && (productLinks.Count > 0 || price.SuppliesCost > 0m))
                {
                    var lines = productLinks.Select(l => new RecipeLine(
                        CostRules.EffectiveQuantity(l.QuantityPerSale, l.AllowancePercent),
                        CostRules.UsableCost(CostRules.MovementCost(l.AverageCost, l.CostPrice), l.YieldPercent)));
                    var summary = CostRules.RecipeCost(lines, price.SuppliesCost);
                    cost = summary.TotalCost;
                    unknown = summary.UnknownCostCount;
                    margin = CostRules.Margin(price.Price, summary.TotalCost);
                    marginPercent = CostRules.MarginPercent(price.Price, summary.TotalCost);
                }

                return new ProductIngredientsRowDto(
                    product.ProductId,
                    product.Name,
                    product.Code,
                    price.Price,
                    product.Status,
                    product.MissingOptions,
                    productLinks.Count,
                    cost,
                    unknown,
                    margin,
                    marginPercent,
                    SubCategoryName: price.SubCategoryName);
            })
            .ToList();

        return new ProductIngredientsDto(coverage.Covered, coverage.Partial, coverage.Missing, request.IncludeCosts, rows);
    }
}
