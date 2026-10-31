using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Inventory.DTOs;
using WTF.Api.Features.Products.Enums;
using WTF.Calculations.Inventory;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory;

public record GetProductRecipePreviewQuery(Guid ProductId, List<Guid> AddOnIds) : IRequest<RecipePreviewDto?>;

// What one sale of a drink with a chosen size and add-ons would use and cost, worked out by the same rules a real sale
// uses (StockRules.Requirements), from the saved ingredient lists. It saves and deducts nothing.
public class GetProductRecipePreviewHandler(WTFDbContext db) : IRequestHandler<GetProductRecipePreviewQuery, RecipePreviewDto?>
{
    public async Task<RecipePreviewDto?> Handle(GetProductRecipePreviewQuery request, CancellationToken cancellationToken)
    {
        var product = await db.Products
            .AsNoTracking()
            .Where(p => p.Id == request.ProductId)
            .Select(p => new { p.Id, p.Name, p.Price, p.IsAddOn, p.SuppliesCost })
            .FirstOrDefaultAsync(cancellationToken);
        if (product is null)
        {
            return null;
        }

        var addOnIds = request.AddOnIds.Distinct().ToList();
        var options = await db.ProductAddOns
            .AsNoTracking()
            .Where(pa => pa.ProductId == product.Id && pa.IsActive && pa.AddOn.IsActive)
            .Select(pa => new
            {
                pa.AddOnId,
                pa.AddOn.Name,
                pa.AddOnTypeId,
                pa.AddOn.RecipeMultiplier,
                Price = pa.ProductAddOnPriceOverride != null && pa.ProductAddOnPriceOverride.IsActive
                    ? pa.ProductAddOnPriceOverride.Price
                    : pa.AddOn.Price
            })
            .ToListAsync(cancellationToken);

        var chosen = options.Where(option => addOnIds.Contains(option.AddOnId)).ToList();
        if (chosen.Count != addOnIds.Count)
        {
            throw new InvalidOperationException("One of the add-ons is not an option of this product.");
        }

        var sizes = options
            .Where(option => option.AddOnTypeId == (int)AddOnTypeEnum.Size)
            .Select(option => (Id: option.AddOnId, option.Name, Multiplier: option.RecipeMultiplier))
            .ToList();
        var parentLine = new StockLine(Guid.NewGuid(), null, product.Id, 1);
        var lines = new List<StockLine> { parentLine };
        lines.AddRange(chosen.Select(option => new StockLine(Guid.NewGuid(), parentLine.LineId, option.AddOnId, 1, option.RecipeMultiplier)));

        var productIds = lines.Select(line => line.ProductId).Distinct().ToList();
        var activeLinks = await db.ProductItemLinks
            .AsNoTracking()
            .Where(link => link.IsActive && productIds.Contains(link.ProductId) && link.Item.IsActive)
            .Select(link => new { link.ProductId, link.ItemId, link.QuantityPerSale, link.AllowancePercent, link.ScalesWithSize, link.ReplacesItemId })
            .ToListAsync(cancellationToken);
        var links = activeLinks
            .Select(link => new StockLink(
                link.ProductId, link.ItemId, CostRules.EffectiveQuantity(link.QuantityPerSale, link.AllowancePercent), link.ScalesWithSize, link.ReplacesItemId))
            .ToList();

        var sizeAmounts = await db.ProductSizeAmounts
            .AsNoTracking()
            .Where(amount => amount.IsActive && amount.ProductId == product.Id && amount.Item.IsActive)
            .Select(amount => new StockSizeAmount(amount.ProductId, amount.SizeProductId, amount.ItemId, amount.Quantity))
            .ToListAsync(cancellationToken);

        var required = StockRules.Requirements(lines, links, sizeAmounts);
        var itemIds = required.Select(r => r.ItemId).Union(activeLinks.Where(l => l.ReplacesItemId.HasValue).Select(l => l.ReplacesItemId!.Value)).Distinct().ToList();
        var items = await db.Items
            .AsNoTracking()
            .Where(item => itemIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, cancellationToken);
        var names = await db.Products
            .AsNoTracking()
            .Where(p => productIds.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => p.Name, cancellationToken);

        var costLines = new List<RecipePreviewLineDto>();
        var replaced = new List<string>();
        foreach (var requirement in required)
        {
            if (!items.TryGetValue(requirement.ItemId, out var item))
            {
                continue;
            }

            if (requirement.Quantity <= 0m)
            {
                replaced.Add(item.Name);
                continue;
            }

            var unitCost = CostRules.UsableCost(CostRules.MovementCost(item.AverageCost, item.CostPrice), item.YieldPercent);
            costLines.Add(new RecipePreviewLineDto(
                item.Id,
                item.Name,
                InventoryUnitLabels.Abbreviate(item.UnitName),
                requirement.Quantity,
                unitCost,
                unitCost.HasValue ? CostRules.LineCost(requirement.Quantity, unitCost.Value) : null,
                requirement.ProductId == product.Id ? null : names[requirement.ProductId]));
        }

        var summary = CostRules.RecipeCost(costLines.Select(line => new RecipeLine(line.Quantity, line.UnitCost)), product.SuppliesCost);
        var price = product.Price + chosen.Sum(option => option.Price);

        return new RecipePreviewDto(
            product.Id,
            product.Name,
            price,
            chosen.Select(option => option.Name).ToList(),
            costLines,
            replaced.Distinct().OrderBy(name => name).ToList(),
            product.SuppliesCost,
            summary.TotalCost,
            summary.UnknownCostCount,
            CostRules.Margin(price, summary.TotalCost),
            CostRules.MarginPercent(price, summary.TotalCost),
            Warnings(sizes, chosen.Select(option => option.AddOnId).ToHashSet(), links.Any(link => link.ProductId == product.Id && link.ScalesWithSize), sizeAmounts));
    }

    private static List<string> Warnings(
        List<(Guid Id, string Name, decimal Multiplier)> sizes,
        HashSet<Guid> chosenIds,
        bool hasScalingLine,
        List<StockSizeAmount> sizeAmounts)
    {
        var warnings = new List<string>();

        if (sizeAmounts.Count > 0)
        {
            warnings.AddRange(sizes
                .Where(size => chosenIds.Contains(size.Id) && sizeAmounts.All(amount => amount.SizeProductId != size.Id))
                .Select(size => $"{size.Name} has no amounts of its own, so it uses the base amounts."));
        }

        if (hasScalingLine && sizes.Count > 0 && sizes.All(size => size.Multiplier == 1m) && sizeAmounts.Count == 0)
        {
            warnings.Add("An ingredient is set to scale with size, but no size has a multiplier, so it never changes.");
        }

        return warnings;
    }
}
