using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Orders;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Calculations.Orders;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

internal static class OfflineOrderReview
{
    private const int MaxReasonsLength = 1000;

    public static string JoinReasons(IEnumerable<string> reasons)
    {
        var text = string.Join("\n", reasons);
        return text.Length <= MaxReasonsLength ? text : string.Concat(text.AsSpan(0, MaxReasonsLength - 1), "…");
    }

    public static decimal QuotedPriceOrThrow(decimal? quoted, string productName)
    {
        return quoted is >= 0
            ? quoted.Value
            : throw new InvalidOperationException($"The quoted price for '{productName}' is missing.");
    }

    public static async Task<List<string>> FindReasonsAsync(
        WTFDbContext db,
        CreateOrderCommand command,
        TimeZoneInfo timeZone,
        CancellationToken cancellationToken)
    {
        var reasons = new List<string>();
        var createdAt = command.CreatedAt?.ToUniversalTime() ?? DateTime.UtcNow;

        var productIds = command.Items
            .Select(i => i.ProductId)
            .Concat(command.Items.SelectMany(i => i.AddOns.Select(a => a.ProductId)))
            .Distinct()
            .ToList();
        var products = await db.Products
            .Where(p => productIds.Contains(p.Id))
            .Select(p => new { p.Id, p.Name, p.Price, p.IsActive })
            .ToDictionaryAsync(p => p.Id, cancellationToken);

        reasons.AddRange(products.Values
            .Where(p => !p.IsActive)
            .Select(p => $"{p.Name} is inactive.")
            .Order());

        if (command.CustomerId.HasValue)
        {
            var customer = await db.Customers
                .Where(c => c.Id == command.CustomerId.Value)
                .Select(c => new { c.FirstName, c.LastName, c.IsActive })
                .FirstOrDefaultAsync(cancellationToken);
            if (customer is { IsActive: false })
            {
                reasons.Add($"Customer {customer.FirstName} {customer.LastName} is inactive.");
            }
        }

        await AddBundleReasonsAsync(db, command, createdAt, timeZone, reasons, cancellationToken);
        await AddPriceReasonsAsync(db, command, products.ToDictionary(p => p.Key, p => (p.Value.Name, p.Value.Price)), createdAt, timeZone, reasons, cancellationToken);

        return [.. reasons.Distinct()];
    }

    private static async Task AddBundleReasonsAsync(
        WTFDbContext db,
        CreateOrderCommand command,
        DateTime createdAt,
        TimeZoneInfo timeZone,
        List<string> reasons,
        CancellationToken cancellationToken)
    {
        if (command.BundlePromotions.Count == 0)
        {
            return;
        }

        var problems = new List<string>();
        Dictionary<Guid, decimal> currentPrices;
        try
        {
            currentPrices = await BundlePromotionResolver.ResolveAsync(
                db, command.BundlePromotions, command.Items, createdAt, timeZone, null, cancellationToken, problems);
        }
        catch (InvalidOperationException)
        {
            // A broken order (duplicate bundle, unknown promotion) is not a stale catalog: the normal create reports it.
            return;
        }

        reasons.AddRange(problems);

        var ids = command.BundlePromotions.Select(b => b.PromotionId).ToList();
        var names = await db.Promotions
            .Where(p => ids.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => p.Name, cancellationToken);

        foreach (var bundle in command.BundlePromotions)
        {
            if (bundle.QuotedUnitPrice.HasValue
                && currentPrices.TryGetValue(bundle.PromotionId, out var current)
                && current != bundle.QuotedUnitPrice.Value)
            {
                reasons.Add($"Bundle '{names[bundle.PromotionId]}' now costs {current:0.00}, quoted {bundle.QuotedUnitPrice.Value:0.00}.");
            }
        }
    }

    private static async Task AddPriceReasonsAsync(
        WTFDbContext db,
        CreateOrderCommand command,
        Dictionary<Guid, (string Name, decimal Price)> products,
        DateTime createdAt,
        TimeZoneInfo timeZone,
        List<string> reasons,
        CancellationToken cancellationToken)
    {
        var parentIds = command.Items.Select(i => i.ProductId).Distinct().ToList();
        var overridePrices = await db.ProductAddOnPriceOverrides
            .Where(o => o.IsActive && parentIds.Contains(o.ProductId))
            .ToDictionaryAsync(o => (o.ProductId, o.AddOnId), o => o.Price, cancellationToken);

        var discountedPromotions = await db.Promotions
            .Where(p => p.TypeId == PromotionTypeIds.DiscountedProduct)
            .Include(p => p.DiscountedProductPromotions)
                .ThenInclude(d => d.DiscountedProductPromotionAddOns)
            .ToListAsync(cancellationToken);
        var rulesByProductId = discountedPromotions
            .Where(p => PromotionPricing.IsPromotionActiveOnLocalDate(p, createdAt, timeZone))
            .SelectMany(p => p.DiscountedProductPromotions)
            .GroupBy(d => d.ProductId)
            .ToDictionary(
                g => g.Key,
                g => g.Select(d => new PromotionPricing.DiscountedRule(
                    d.FixedPrice,
                    d.PercentOff,
                    [.. d.DiscountedProductPromotionAddOns.Select(a => (a.AddOnProductId, a.Quantity))])).ToList());

        foreach (var item in command.Items)
        {
            if (!products.TryGetValue(item.ProductId, out var product))
            {
                continue;
            }

            if (item.QuotedPrice.HasValue && !item.BundlePromotionId.HasValue)
            {
                var discounted = PromotionPricing.GetDiscountedUnitPrice(
                    product.Price,
                    item.ProductId,
                    item.AddOns.Select(a => (a.ProductId, a.Quantity)),
                    rulesByProductId);
                var current = discounted?.Price ?? product.Price;
                if (current != item.QuotedPrice.Value)
                {
                    reasons.Add($"{product.Name} now costs {current:0.00}, quoted {item.QuotedPrice.Value:0.00}.");
                }
            }

            foreach (var addOn in item.AddOns)
            {
                if (!addOn.QuotedPrice.HasValue || !products.TryGetValue(addOn.ProductId, out var addOnProduct))
                {
                    continue;
                }

                var currentAddOn = overridePrices.TryGetValue((item.ProductId, addOn.ProductId), out var overridePrice)
                    ? overridePrice
                    : addOnProduct.Price;
                if (currentAddOn != addOn.QuotedPrice.Value)
                {
                    reasons.Add($"{addOnProduct.Name} on {product.Name} now costs {currentAddOn:0.00}, quoted {addOn.QuotedPrice.Value:0.00}.");
                }
            }
        }
    }
}
