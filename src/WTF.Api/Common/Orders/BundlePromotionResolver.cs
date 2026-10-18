using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Orders.DTOs;
using WTF.Calculations.Orders;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Common.Orders;

internal static class BundlePromotionResolver
{
    public static async Task<Dictionary<Guid, decimal>> ResolveAsync(
        WTFDbContext db,
        IReadOnlyList<OrderBundlePromotionRequestDto> bundles,
        IReadOnlyList<OrderItemRequestDto> items,
        DateTime referenceUtc,
        TimeZoneInfo timeZone,
        IReadOnlyDictionary<Guid, decimal>? savedUnitPrices,
        CancellationToken cancellationToken,
        List<string>? problems = null)
    {
        EnsureStructure(bundles, items);

        var prices = new Dictionary<Guid, decimal>();
        if (bundles.Count == 0)
        {
            return prices;
        }

        var bundleIds = bundles.Select(b => b.PromotionId).ToHashSet();

        // A bundle that is already on a completed order keeps the price it was sold at. Its rules are not re-checked,
        // because the sale already happened and the promotion may have ended or changed since.
        var alreadySold = bundleIds
            .Where(id => savedUnitPrices is not null && savedUnitPrices.ContainsKey(id))
            .ToHashSet();
        foreach (var id in alreadySold)
        {
            prices[id] = savedUnitPrices![id];
        }

        var checkedIds = bundleIds.Except(alreadySold).ToList();
        if (checkedIds.Count == 0)
        {
            return prices;
        }

        var promotions = await LoadPromotionsAsync(db, checkedIds, cancellationToken);

        var productIds = promotions
            .SelectMany(p => p.FixedBundlePromotion?.FixedBundlePromotionItems.Select(i => i.ProductId) ?? [])
            .Concat(promotions.SelectMany(p => p.MixMatchPromotion?.MixMatchPromotionProducts.Select(i => i.ProductId) ?? []))
            .Concat(items.Select(i => i.ProductId))
            .Distinct()
            .ToList();
        var names = await db.Products
            .Where(p => productIds.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => p.Name, cancellationToken);
        string NameOf(Guid id) => names.TryGetValue(id, out var name) ? name : "an unknown product";

        foreach (var promotion in promotions)
        {
            var price = promotion.FixedBundlePromotion?.BundlePrice ?? promotion.MixMatchPromotion!.BundlePrice;
            prices[promotion.Id] = price;

            string? problem;
            if (!PromotionPricing.IsPromotionActiveOnLocalDate(promotion, referenceUtc, timeZone))
            {
                problem = $"Bundle promotion '{promotion.Name}' is inactive or outside its active date range.";
            }
            else
            {
                var quantity = bundles.Single(b => b.PromotionId == promotion.Id).Quantity;
                var lines = items
                    .Where(i => i.BundlePromotionId == promotion.Id)
                    .Select(i => new BundleRules.Line(i.ProductId, i.Quantity, [.. i.AddOns.Select(a => (a.ProductId, a.Quantity))]))
                    .ToList();

                problem = promotion.FixedBundlePromotion is not null
                    ? BundleRules.CheckFixedBundle(promotion.FixedBundlePromotion, promotion.Name, quantity, lines, NameOf)
                    : BundleRules.CheckMixMatch(promotion.MixMatchPromotion!, promotion.Name, quantity, lines, NameOf);

                if (problem is null && price < 0)
                {
                    problem = "The bundle price cannot be negative.";
                }
            }

            if (problem is null)
            {
                continue;
            }

            if (problems is null)
            {
                throw new InvalidOperationException(problem);
            }

            problems.Add(problem);
        }

        return prices;
    }

    public static async Task<Dictionary<Guid, decimal>> ResolveHeldAsync(
        WTFDbContext db,
        IReadOnlyList<OrderBundlePromotionRequestDto> bundles,
        IReadOnlyList<OrderItemRequestDto> items,
        CancellationToken cancellationToken)
    {
        EnsureStructure(bundles, items);

        var prices = new Dictionary<Guid, decimal>();
        if (bundles.Count == 0)
        {
            return prices;
        }

        await LoadPromotionsAsync(db, [.. bundles.Select(b => b.PromotionId)], cancellationToken);

        foreach (var bundle in bundles)
        {
            if (bundle.QuotedUnitPrice is null or < 0)
            {
                throw new InvalidOperationException("The quoted bundle price is missing.");
            }

            prices[bundle.PromotionId] = bundle.QuotedUnitPrice.Value;
        }

        return prices;
    }

    private static void EnsureStructure(IReadOnlyList<OrderBundlePromotionRequestDto> bundles, IReadOnlyList<OrderItemRequestDto> items)
    {
        foreach (var group in bundles.GroupBy(b => b.PromotionId))
        {
            if (group.Count() > 1)
            {
                throw new InvalidOperationException("Duplicate bundle promotions are not allowed.");
            }

            if (group.Single().Quantity <= 0)
            {
                throw new InvalidOperationException("Bundle promotion quantity must be greater than zero.");
            }
        }

        var bundleIds = bundles.Select(b => b.PromotionId).ToHashSet();
        foreach (var item in items)
        {
            if (item.BundlePromotionId.HasValue && !bundleIds.Contains(item.BundlePromotionId.Value))
            {
                throw new InvalidOperationException("Order item references an unknown bundle promotion.");
            }
        }
    }

    private static async Task<List<Promotion>> LoadPromotionsAsync(
        WTFDbContext db, List<Guid> ids, CancellationToken cancellationToken)
    {
        var promotions = await db.Promotions
            .Where(p => ids.Contains(p.Id) && (p.FixedBundlePromotion != null || p.MixMatchPromotion != null))
            .Include(p => p.FixedBundlePromotion!)
                .ThenInclude(f => f.FixedBundlePromotionItems)
                    .ThenInclude(i => i.FixedBundlePromotionItemAddOns)
            .Include(p => p.MixMatchPromotion!)
                .ThenInclude(m => m.MixMatchPromotionProducts)
                    .ThenInclude(i => i.MixMatchPromotionProductAddOns)
            .ToListAsync(cancellationToken);

        if (promotions.Count != ids.Count)
        {
            throw new InvalidOperationException("One or more bundle promotions are invalid.");
        }

        return promotions;
    }
}
