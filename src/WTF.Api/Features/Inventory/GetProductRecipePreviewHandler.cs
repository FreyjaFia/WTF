using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Inventory.DTOs;
using WTF.Api.Features.Catalog;
using WTF.Calculations.Inventory;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory;

public record GetProductRecipePreviewQuery(
    Guid ProductId,
    List<Guid> AddOnIds,
    List<ProductIngredientInputDto>? DraftLines = null,
    decimal? DraftSuppliesCost = null) : IRequest<RecipePreviewDto?>;

// What one sale of a drink with a chosen size and add-ons would use and cost, worked out by the same rules a real sale
// uses (StockRules.Requirements), from the saved ingredient lists, or from the unsaved lines of the open editor when a draft
// is sent (it replaces this product's own lines and size amounts for the answer only). It saves and deducts nothing.
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

        var countById = request.AddOnIds.GroupBy(id => id).ToDictionary(group => group.Key, group => group.Count());
        var addOnIds = countById.Keys.ToList();
        var options = await db.ProductAddOns
            .AsNoTracking()
            .Where(pa => pa.ProductId == product.Id && pa.IsActive && pa.AddOn.IsActive)
            .Select(pa => new
            {
                pa.AddOnId,
                pa.AddOn.Name,
                pa.AddOnTypeId,
                IsSize = pa.AddOnType != null && pa.AddOnType.SystemKey == SystemAddOnTypes.SizeKey,
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
            .Where(option => option.IsSize)
            .Select(option => (Id: option.AddOnId, option.Name))
            .ToList();
        var parentLine = new StockLine(Guid.NewGuid(), null, product.Id, 1);
        var lines = new List<StockLine> { parentLine };
        lines.AddRange(chosen.Select(option => new StockLine(Guid.NewGuid(), parentLine.LineId, option.AddOnId, countById[option.AddOnId])));

        var productIds = lines.Select(line => line.ProductId).Distinct().ToList();
        var draft = request.DraftLines;
        var activeLinks = await db.ProductItemLinks
            .AsNoTracking()
            .Where(link => link.IsActive && productIds.Contains(link.ProductId) && link.Item.IsActive
                && (draft == null || link.ProductId != product.Id))
            .Select(link => new { link.ProductId, link.ItemId, link.QuantityPerSale, link.AllowancePercent, link.ReplacesItemId })
            .ToListAsync(cancellationToken);

        List<Guid> activeDraftItemIds = [];
        if (draft is not null)
        {
            var draftItemIds = draft.Select(line => line.ItemId).Distinct().ToList();
            activeDraftItemIds = await db.Items
                .AsNoTracking()
                .Where(item => item.IsActive && draftItemIds.Contains(item.Id))
                .Select(item => item.Id)
                .ToListAsync(cancellationToken);
            activeLinks.AddRange(draft
                .Where(line => activeDraftItemIds.Contains(line.ItemId))
                .Select(line => new { ProductId = product.Id, line.ItemId, QuantityPerSale = line.QuantityPerSale, line.AllowancePercent, line.ReplacesItemId }));
        }
        var links = activeLinks
            .Select(link => new StockLink(
                link.ProductId, link.ItemId, CostRules.EffectiveQuantity(link.QuantityPerSale, link.AllowancePercent), link.ReplacesItemId))
            .ToList();

        var sizeAmounts = draft is null
            ? await db.ProductSizeAmounts
                .AsNoTracking()
                .Where(amount => amount.IsActive && amount.ProductId == product.Id && amount.Item.IsActive)
                .Select(amount => new StockSizeAmount(amount.ProductId, amount.SizeProductId, amount.ItemId, amount.Quantity))
                .ToListAsync(cancellationToken)
            : draft
                .Where(line => activeDraftItemIds.Contains(line.ItemId))
                .SelectMany(line => (line.SizeAmounts ?? []).Select(amount => new StockSizeAmount(product.Id, amount.SizeProductId, line.ItemId, amount.Quantity)))
                .ToList();

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

        costLines = costLines
            .OrderBy(line => line.SourceName is not null)
            .ThenBy(line => line.SourceName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(line => line.ItemName, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var suppliesCost = request.DraftSuppliesCost is >= 0m ? request.DraftSuppliesCost.Value : product.SuppliesCost;
        var summary = CostRules.RecipeCost(costLines.Select(line => new RecipeLine(line.Quantity, line.UnitCost)), suppliesCost);
        var price = product.Price + chosen.Sum(option => option.Price * countById[option.AddOnId]);

        return new RecipePreviewDto(
            product.Id,
            product.Name,
            price,
            chosen.Select(option => countById[option.AddOnId] > 1 ? $"{option.Name} x{countById[option.AddOnId]}" : option.Name).ToList(),
            costLines,
            replaced.Distinct().OrderBy(name => name).ToList(),
            suppliesCost,
            summary.TotalCost,
            summary.UnknownCostCount,
            CostRules.Margin(price, summary.TotalCost),
            CostRules.MarginPercent(price, summary.TotalCost),
            Warnings(sizes, chosen.Select(option => option.AddOnId).ToHashSet(), sizeAmounts));
    }

    private static List<string> Warnings(
        List<(Guid Id, string Name)> sizes,
        HashSet<Guid> chosenIds,
        List<StockSizeAmount> sizeAmounts)
    {
        var warnings = new List<string>();

        if (sizeAmounts.Count > 0)
        {
            warnings.AddRange(sizes
                .Where(size => chosenIds.Contains(size.Id) && sizeAmounts.All(amount => amount.SizeProductId != size.Id))
                .Select(size => $"{size.Name} has no amounts of its own, so it uses the base amounts."));
        }

        return warnings;
    }
}

public record RecipePreviewDraftRequest(List<Guid>? AddOnIds, List<ProductIngredientInputDto>? Lines, decimal? SuppliesCost);
