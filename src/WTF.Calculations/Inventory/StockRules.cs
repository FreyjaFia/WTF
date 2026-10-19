namespace WTF.Calculations.Inventory;

public enum StockStatus
{
    Ok = 0,
    Warning = 1,
    Critical = 2,
    OutOfStock = 3
}

public record StockLine(Guid LineId, Guid? ParentLineId, Guid ProductId, int Quantity);

public record StockLink(Guid ProductId, Guid ItemId, decimal QuantityPerSale);

public record StockRequirement(Guid ItemId, Guid ProductId, decimal Quantity, Guid? OrderLineId);

public record StockChange(Guid ItemId, Guid ProductId, decimal Quantity, Guid? OrderLineId);

public static class StockRules
{
    private const int QuantityDecimals = 3;

    public static StockStatus StatusFor(decimal quantity, decimal? warningQuantity, decimal? criticalQuantity)
    {
        if (quantity <= 0m)
        {
            return StockStatus.OutOfStock;
        }

        if (criticalQuantity.HasValue && quantity <= criticalQuantity.Value)
        {
            return StockStatus.Critical;
        }

        if (warningQuantity.HasValue && quantity <= warningQuantity.Value)
        {
            return StockStatus.Warning;
        }

        return StockStatus.Ok;
    }

    public static decimal StockValue(decimal quantity, decimal? costPrice) =>
        costPrice.HasValue ? Math.Max(0m, quantity) * costPrice.Value : 0m;

    // Add-on lines carry their quantity per unit of the parent line, so an add-on takes stock for every unit sold. The
    // quantities are summed per item and product first: one line is checked and deducted once, however many lines share it.
    public static List<StockRequirement> Requirements(IReadOnlyList<StockLine> lines, IReadOnlyList<StockLink> links)
    {
        var parentQuantityById = lines.ToDictionary(line => line.LineId, line => line.Quantity);
        var linksByProduct = links.ToLookup(link => link.ProductId);
        var parts = new List<(Guid ItemId, Guid ProductId, decimal Quantity, Guid LineId)>();

        foreach (var line in lines)
        {
            var units = line.ParentLineId.HasValue && parentQuantityById.TryGetValue(line.ParentLineId.Value, out var parentQuantity)
                ? (decimal)line.Quantity * parentQuantity
                : line.Quantity;

            foreach (var link in linksByProduct[line.ProductId])
            {
                parts.Add((link.ItemId, link.ProductId, link.QuantityPerSale * units, line.LineId));
            }
        }

        return parts
            .GroupBy(part => (part.ItemId, part.ProductId))
            .OrderBy(group => group.Key.ItemId)
            .ThenBy(group => group.Key.ProductId)
            .Select(group =>
            {
                var lineIds = group.Select(part => part.LineId).Distinct().ToList();
                return new StockRequirement(
                    group.Key.ItemId,
                    group.Key.ProductId,
                    Round(group.Sum(part => part.Quantity)),
                    lineIds.Count == 1 ? lineIds[0] : null);
            })
            .Where(requirement => requirement.Quantity > 0m)
            .ToList();
    }

    // The stock change that brings what an order already took (positive quantities) to what it needs now. Negative takes
    // stock, positive gives it back. An order whose needs did not change gives an empty list, so saving twice never deducts twice.
    public static List<StockChange> Reconcile(IReadOnlyList<StockRequirement> required, IReadOnlyList<StockChange> alreadyTaken)
    {
        var needed = required.ToDictionary(r => (r.ItemId, r.ProductId), r => (r.Quantity, r.OrderLineId));
        var taken = alreadyTaken
            .GroupBy(t => (t.ItemId, t.ProductId))
            .ToDictionary(group => group.Key, group => Round(group.Sum(t => t.Quantity)));

        var changes = new List<StockChange>();
        foreach (var key in needed.Keys.Union(taken.Keys).OrderBy(k => k.ItemId).ThenBy(k => k.ProductId))
        {
            var need = needed.TryGetValue(key, out var n) ? n.Quantity : 0m;
            var have = taken.TryGetValue(key, out var t) ? t : 0m;
            var difference = Round(have - need);
            if (difference != 0m)
            {
                changes.Add(new StockChange(key.ItemId, key.ProductId, difference, needed.TryGetValue(key, out var line) ? line.OrderLineId : null));
            }
        }

        return changes;
    }

    public static decimal Shortfall(decimal balance, decimal quantityToTake) =>
        Math.Max(0m, Round(quantityToTake - Math.Max(0m, balance)));

    public static decimal ReturnedShare(decimal quantity, decimal returnedWeight, decimal totalWeight)
    {
        if (totalWeight <= 0m || returnedWeight <= 0m)
        {
            return 0m;
        }

        return returnedWeight >= totalWeight ? quantity : Round(quantity * returnedWeight / totalWeight);
    }

    public static decimal AdjustmentDelta(decimal currentQuantity, decimal countedQuantity) =>
        Round(countedQuantity - currentQuantity);

    public static decimal Round(decimal quantity) =>
        Math.Round(quantity, QuantityDecimals, MidpointRounding.AwayFromZero);
}
