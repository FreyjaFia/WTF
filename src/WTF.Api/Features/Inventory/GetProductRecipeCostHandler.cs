using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Inventory.DTOs;
using WTF.Calculations.Inventory;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory;

public record GetProductRecipeCostQuery(Guid ProductId) : IRequest<RecipeCostDto?>;

public class GetProductRecipeCostHandler(WTFDbContext db) : IRequestHandler<GetProductRecipeCostQuery, RecipeCostDto?>
{
    public async Task<RecipeCostDto?> Handle(GetProductRecipeCostQuery request, CancellationToken cancellationToken)
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
                var effective = CostRules.EffectiveQuantity(l.QuantityPerSale, l.AllowancePercent);
                var unitCost = CostRules.UsableCost(CostRules.MovementCost(l.AverageCost, l.CostPrice), l.YieldPercent);
                return new RecipeCostLineDto(
                    l.Id,
                    l.ItemId,
                    l.ItemName,
                    InventoryUnitLabels.Abbreviate(l.UnitName),
                    l.QuantityPerSale,
                    l.AllowancePercent,
                    effective,
                    unitCost,
                    unitCost.HasValue ? CostRules.LineCost(effective, unitCost.Value) : null,
                    l.ScalesWithSize,
                    l.ReplacesItemId,
                    l.ReplacesItemName);
            })
            .ToList();

        var summary = CostRules.RecipeCost(lines.Select(l => new RecipeLine(l.EffectiveQuantity, l.UnitCost)), product.SuppliesCost);

        return new RecipeCostDto(
            product.Id,
            product.Name,
            product.Price,
            lines,
            summary.TotalCost,
            summary.UnknownCostCount,
            CostRules.Margin(product.Price, summary.TotalCost),
            CostRules.MarginPercent(product.Price, summary.TotalCost),
            product.IsAddOn,
            product.RecipeMultiplier,
            product.SuppliesCost);
    }
}
