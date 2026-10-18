using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Orders.DTOs;
using WTF.Calculations.Orders;
using WTF.Domain.Data;

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
        CancellationToken cancellationToken)
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

        var prices = new Dictionary<Guid, decimal>();
        if (bundles.Count == 0)
        {
            return prices;
        }

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

        var promotions = await db.Promotions
            .Where(p => checkedIds.Contains(p.Id) && (p.FixedBundlePromotion != null || p.MixMatchPromotion != null))
            .Include(p => p.FixedBundlePromotion!)
                .ThenInclude(f => f.FixedBundlePromotionItems)
                    .ThenInclude(i => i.FixedBundlePromotionItemAddOns)
            .Include(p => p.MixMatchPromotion!)
                .ThenInclude(m => m.MixMatchPromotionProducts)
                    .ThenInclude(i => i.MixMatchPromotionProductAddOns)
            .ToListAsync(cancellationToken);

        if (promotions.Count != checkedIds.Count)
        {
            throw new InvalidOperationException("One or more bundle promotions are invalid.");
        }

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
            if (!PromotionPricing.IsPromotionActiveOnLocalDate(promotion, referenceUtc, timeZone))
            {
                throw new InvalidOperationException($"Bundle promotion '{promotion.Name}' is inactive or outside its active date range.");
            }

            var quantity = bundles.Single(b => b.PromotionId == promotion.Id).Quantity;
            var lines = items
                .Where(i => i.BundlePromotionId == promotion.Id)
                .Select(i => new BundleRules.Line(i.ProductId, i.Quantity, [.. i.AddOns.Select(a => (a.ProductId, a.Quantity))]))
                .ToList();

            var problem = promotion.FixedBundlePromotion is not null
                ? BundleRules.CheckFixedBundle(promotion.FixedBundlePromotion, promotion.Name, quantity, lines, NameOf)
                : BundleRules.CheckMixMatch(promotion.MixMatchPromotion!, promotion.Name, quantity, lines, NameOf);
            if (problem is not null)
            {
                throw new InvalidOperationException(problem);
            }

            var price = promotion.FixedBundlePromotion?.BundlePrice ?? promotion.MixMatchPromotion!.BundlePrice;
            if (price < 0)
            {
                throw new InvalidOperationException("The bundle price cannot be negative.");
            }

            prices[promotion.Id] = price;
        }

        return prices;
    }
}
