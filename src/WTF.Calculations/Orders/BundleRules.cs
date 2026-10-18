using WTF.Domain.Entities;

namespace WTF.Calculations.Orders;

public static class BundleRules
{
    public sealed record Line(Guid ProductId, int Quantity, IReadOnlyList<(Guid AddOnProductId, int Quantity)> AddOns);

    public static string? CheckFixedBundle(
        FixedBundlePromotion bundle,
        string promotionName,
        int bundleQuantity,
        IReadOnlyList<Line> lines,
        Func<Guid, string> nameOf)
    {
        var expectedByProduct = bundle.FixedBundlePromotionItems.ToDictionary(x => x.ProductId);

        foreach (var line in lines)
        {
            if (!expectedByProduct.ContainsKey(line.ProductId))
            {
                return NotIncluded(promotionName, nameOf(line.ProductId));
            }
        }

        foreach (var item in bundle.FixedBundlePromotionItems)
        {
            var found = lines.Where(x => x.ProductId == item.ProductId).Sum(x => x.Quantity);
            var expected = item.Quantity * bundleQuantity;
            if (found != expected)
            {
                return $"Bundle '{promotionName}' needs {expected} x {nameOf(item.ProductId)}, but the order has {found}.";
            }

            var expectedAddOns = ToAddOnMap(item.FixedBundlePromotionItemAddOns.Select(x => (x.AddOnProductId, x.Quantity)));
            var mismatch = lines
                .Where(x => x.ProductId == item.ProductId)
                .Any(x => !SameAddOns(ToAddOnMap(x.AddOns), expectedAddOns));
            if (mismatch)
            {
                return AddOnsDiffer(promotionName, nameOf(item.ProductId));
            }
        }

        return null;
    }

    public static string? CheckMixMatch(
        MixMatchPromotion bundle,
        string promotionName,
        int bundleQuantity,
        IReadOnlyList<Line> lines,
        Func<Guid, string> nameOf)
    {
        var allowedByProduct = bundle.MixMatchPromotionProducts.ToDictionary(x => x.ProductId);

        foreach (var line in lines)
        {
            if (!allowedByProduct.ContainsKey(line.ProductId))
            {
                return NotIncluded(promotionName, nameOf(line.ProductId));
            }
        }

        var required = bundle.RequiredQuantity * bundleQuantity;
        var total = lines.Sum(x => x.Quantity);
        if (total != required)
        {
            return $"Bundle '{promotionName}' needs {required} items, but the order has {total}.";
        }

        foreach (var group in lines.GroupBy(x => x.ProductId))
        {
            var count = group.Sum(x => x.Quantity);
            if (bundle.MaxSelectionsPerOrder.HasValue && count > bundle.MaxSelectionsPerOrder.Value * bundleQuantity)
            {
                return $"Bundle '{promotionName}' allows at most {bundle.MaxSelectionsPerOrder.Value * bundleQuantity} x {nameOf(group.Key)}, but the order has {count}.";
            }

            var expectedAddOns = ToAddOnMap(allowedByProduct[group.Key].MixMatchPromotionProductAddOns
                .Select(x => (x.AddOnProductId, x.Quantity)));
            if (group.Any(x => !SameAddOns(ToAddOnMap(x.AddOns), expectedAddOns)))
            {
                return AddOnsDiffer(promotionName, nameOf(group.Key));
            }
        }

        return null;
    }

    private static string NotIncluded(string promotionName, string productName)
    {
        return $"Bundle '{promotionName}' does not include {productName}.";
    }

    private static string AddOnsDiffer(string promotionName, string productName)
    {
        return $"Bundle '{promotionName}': the add-ons on {productName} do not match the bundle.";
    }

    private static Dictionary<Guid, int> ToAddOnMap(IEnumerable<(Guid AddOnProductId, int Quantity)> addOns)
    {
        return addOns
            .GroupBy(x => x.AddOnProductId)
            .ToDictionary(x => x.Key, x => x.Sum(y => y.Quantity));
    }

    private static bool SameAddOns(Dictionary<Guid, int> actual, Dictionary<Guid, int> expected)
    {
        return actual.Count == expected.Count
            && expected.All(x => actual.TryGetValue(x.Key, out var quantity) && quantity == x.Value);
    }
}
