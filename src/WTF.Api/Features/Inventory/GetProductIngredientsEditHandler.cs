using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Inventory.DTOs;
using WTF.Calculations.Inventory;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory;

public record GetProductIngredientsEditQuery(Guid ProductId, bool IncludeCosts) : IRequest<ProductIngredientsEditDto?>;

// One product's ingredient lines for the full-page editor. Unlike the recipe cost, anyone who can read items may see the
// lines; the costs, the supplies cost and the margin are filled in only for the cost roles.
public class GetProductIngredientsEditHandler(WTFDbContext db) : IRequestHandler<GetProductIngredientsEditQuery, ProductIngredientsEditDto?>
{
    public async Task<ProductIngredientsEditDto?> Handle(GetProductIngredientsEditQuery request, CancellationToken cancellationToken)
    {
        var product = await db.Products
            .AsNoTracking()
            .Where(p => p.Id == request.ProductId)
            .Select(p => new { p.Id, p.Name, p.Price, p.IsAddOn, p.RecipeMultiplier, p.SuppliesCost })
            .FirstOrDefaultAsync(cancellationToken);
        if (product is null)
        {
            return null;
        }

        var links = await db.ProductItemLinks
            .AsNoTracking()
            .Where(l => l.ProductId == product.Id && l.IsActive && l.Item.IsActive)
            .OrderBy(l => l.Item.Name)
            .Select(l => new
            {
                l.Id,
                l.ItemId,
                ItemName = l.Item.Name,
                l.Item.UnitName,
                l.QuantityPerSale,
                l.AllowancePercent,
                l.Item.AverageCost,
                l.Item.CostPrice,
                l.Item.YieldPercent,
                l.ScalesWithSize,
                l.ReplacesItemId,
                ReplacesItemName = l.ReplacesItem != null ? l.ReplacesItem.Name : null
            })
            .ToListAsync(cancellationToken);

        var lines = links
            .Select(l =>
            {
                var unitCost = request.IncludeCosts
                    ? CostRules.UsableCost(CostRules.MovementCost(l.AverageCost, l.CostPrice), l.YieldPercent)
                    : null;
                var effective = CostRules.EffectiveQuantity(l.QuantityPerSale, l.AllowancePercent);
                return new ProductIngredientLineDto(
                    l.Id,
                    l.ItemId,
                    l.ItemName,
                    InventoryUnitLabels.Abbreviate(l.UnitName),
                    l.QuantityPerSale,
                    l.AllowancePercent,
                    l.ScalesWithSize,
                    l.ReplacesItemId,
                    l.ReplacesItemName,
                    unitCost,
                    unitCost.HasValue ? CostRules.LineCost(effective, unitCost.Value) : null);
            })
            .ToList();

        decimal? total = null;
        var unknown = 0;
        decimal? margin = null;
        decimal? marginPercent = null;
        if (request.IncludeCosts)
        {
            var summary = CostRules.RecipeCost(
                links.Zip(lines, (l, line) => new RecipeLine(CostRules.EffectiveQuantity(l.QuantityPerSale, l.AllowancePercent), line.UnitCost)),
                product.SuppliesCost);
            total = summary.TotalCost;
            unknown = summary.UnknownCostCount;
            margin = CostRules.Margin(product.Price, summary.TotalCost);
            marginPercent = CostRules.MarginPercent(product.Price, summary.TotalCost);
        }

        return new ProductIngredientsEditDto(
            product.Id,
            product.Name,
            product.Price,
            product.IsAddOn,
            product.RecipeMultiplier,
            request.IncludeCosts,
            request.IncludeCosts ? product.SuppliesCost : null,
            lines,
            total,
            unknown,
            margin,
            marginPercent);
    }
}
