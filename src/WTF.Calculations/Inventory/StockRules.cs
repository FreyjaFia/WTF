namespace WTF.Calculations.Inventory;

public enum StockStatus
{
    Ok = 0,
    Warning = 1,
    Critical = 2,
    OutOfStock = 3
}

public record StockLine(Guid LineId, Guid? ParentLineId, Guid ProductId, int Quantity, decimal RecipeMultiplier = 1m);

public record StockLink(Guid ProductId, Guid ItemId, decimal QuantityPerSale, bool ScalesWithSize = false, Guid? ReplacesItemId = null);

public record StockSizeAmount(Guid ProductId, Guid SizeProductId, Guid ItemId, decimal Quantity);

public record StockRequirement(Guid ItemId, Guid ProductId, decimal Quantity, Guid? OrderLineId);

public record StockChange(Guid ItemId, Guid ProductId, decimal Quantity, Guid? OrderLineId);

public record StockShortfall(Guid ItemId, decimal Needed, decimal Balance, decimal Short);

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
    //
    // A size amount is a flat amount for one item on one drink when one size is on it: it replaces the drink's own amount for
    // that item (and ignores the size multiplier for it), unless an add-on on the drink replaces that item.
    //
    // A recipe follows what is on the drink. A size add-on has a RecipeMultiplier, and a link marked ScalesWithSize is
    // multiplied by the multipliers of the add-ons on the same drink (the drink's own links and the other add-ons' links
    // alike). An add-on's link may name an item it REPLACES: the drink's own link to that item is then not taken. A replaced
    // link stays in the result with a quantity of zero, so a saved order gives back what it took before the add-on was added.
    public static List<StockRequirement> Requirements(
        IReadOnlyList<StockLine> lines, IReadOnlyList<StockLink> links, IReadOnlyList<StockSizeAmount>? sizeAmounts = null)
    {
        var parentQuantityById = lines.ToDictionary(line => line.LineId, line => line.Quantity);
        var childrenByParent = lines.Where(line => line.ParentLineId.HasValue).ToLookup(line => line.ParentLineId!.Value);
        var linksByProduct = links.ToLookup(link => link.ProductId);
        var parts = new List<(Guid ItemId, Guid ProductId, decimal Quantity, Guid LineId, bool Replaced)>();

        foreach (var line in lines)
        {
            var units = line.ParentLineId.HasValue && parentQuantityById.TryGetValue(line.ParentLineId.Value, out var parentQuantity)
                ? (decimal)line.Quantity * parentQuantity
                : line.Quantity;

            var ownChildren = childrenByParent[line.LineId].ToList();
            var scaleSource = ownChildren.Count > 0 || !line.ParentLineId.HasValue
                ? ownChildren
                : childrenByParent[line.ParentLineId.Value].ToList();
            var scale = scaleSource.Aggregate(1m, (current, child) => current * (child.RecipeMultiplier > 0m ? child.RecipeMultiplier : 1m));
            var replaced = ownChildren
                .SelectMany(child => linksByProduct[child.ProductId])
                .Where(link => link.ReplacesItemId.HasValue)
                .Select(link => link.ReplacesItemId!.Value)
                .ToHashSet();

            var ownSizeIds = ownChildren.Select(child => child.ProductId).ToHashSet();
            var flat = sizeAmounts is null || ownSizeIds.Count == 0
                ? new Dictionary<Guid, decimal>()
                : sizeAmounts
                    .Where(amount => amount.ProductId == line.ProductId && ownSizeIds.Contains(amount.SizeProductId))
                    .GroupBy(amount => amount.ItemId)
                    .ToDictionary(group => group.Key, group => group.OrderBy(amount => amount.SizeProductId).First().Quantity);

            foreach (var link in linksByProduct[line.ProductId])
            {
                if (replaced.Contains(link.ItemId))
                {
                    parts.Add((link.ItemId, link.ProductId, 0m, line.LineId, true));
                    continue;
                }

                if (flat.Remove(link.ItemId, out var flatQuantity))
                {
                    parts.Add((link.ItemId, link.ProductId, flatQuantity * units, line.LineId, false));
                    continue;
                }

                parts.Add((link.ItemId, link.ProductId, link.QuantityPerSale * (link.ScalesWithSize ? scale : 1m) * units, line.LineId, false));
            }

            // A size amount for an item the drink has no line for (a cup only the biggest size uses) adds that item.
            foreach (var (itemId, flatQuantity) in flat.Where(entry => !replaced.Contains(entry.Key)))
            {
                parts.Add((itemId, line.ProductId, flatQuantity * units, line.LineId, false));
            }
        }

        return parts
            .GroupBy(part => (part.ItemId, part.ProductId))
            .OrderBy(group => group.Key.ItemId)
            .ThenBy(group => group.Key.ProductId)
            .Select(group =>
            {
                var lineIds = group.Select(part => part.LineId).Distinct().ToList();
                return new
                {
                    Requirement = new StockRequirement(
                        group.Key.ItemId,
                        group.Key.ProductId,
                        Round(group.Sum(part => part.Quantity)),
                        lineIds.Count == 1 ? lineIds[0] : null),
                    KeepAtZero = group.Any(part => part.Replaced)
                };
            })
            .Where(entry => entry.Requirement.Quantity > 0m || entry.KeepAtZero)
            .Select(entry => entry.Requirement)
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

    // What a cart cannot get from the items that block sales when they run short, so the POS can say so before payment.
    // `blockingBalances` holds only those items; every other item is left out. Needs are summed per item across all lines.
    public static List<StockShortfall> Shortfalls(
        IReadOnlyList<StockLine> lines, IReadOnlyList<StockLink> links, IReadOnlyDictionary<Guid, decimal> blockingBalances,
        IReadOnlyList<StockSizeAmount>? sizeAmounts = null)
    {
        return Requirements(lines, links, sizeAmounts)
            .Where(requirement => blockingBalances.ContainsKey(requirement.ItemId))
            .GroupBy(requirement => requirement.ItemId)
            .Select(group =>
            {
                var needed = Round(group.Sum(requirement => requirement.Quantity));
                var balance = blockingBalances[group.Key];
                return new StockShortfall(group.Key, needed, balance, Shortfall(balance, needed));
            })
            .Where(shortfall => shortfall.Short > 0m)
            .OrderBy(shortfall => shortfall.ItemId)
            .ToList();
    }

    public static decimal ReturnedShare(decimal quantity, decimal returnedWeight, decimal totalWeight)
    {
        if (totalWeight <= 0m || returnedWeight <= 0m)
        {
            return 0m;
        }

        return returnedWeight >= totalWeight ? quantity : Round(quantity * returnedWeight / totalWeight);
    }

    // How many whole sales the balance covers when each sale takes `quantityPerSale`. Zero for an empty or negative balance.
    public static int SalesCovered(decimal balance, decimal quantityPerSale)
    {
        if (quantityPerSale <= 0m || balance <= 0m)
        {
            return 0;
        }

        return (int)Math.Floor(Round(balance) / Round(quantityPerSale));
    }

    public static decimal AdjustmentDelta(decimal currentQuantity, decimal countedQuantity) =>
        Round(countedQuantity - currentQuantity);

    public static decimal Round(decimal quantity) =>
        Math.Round(quantity, QuantityDecimals, MidpointRounding.AwayFromZero);
}
