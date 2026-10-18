using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Calculations.Orders;
using WTF.Domain.Data;

namespace WTF.Api.Common.Orders;

internal static class DiscountRuleLoader
{
    internal sealed record Loaded(
        Dictionary<Guid, List<PromotionPricing.DiscountedRule>> RulesByProductId,
        DiscountBudget Budget);

    // The discounted-product rules that are on at that moment (dates, weekdays and hours in the shop's time zone), with
    // how many more items each promotion with a usage limit may still discount. exceptOrderId leaves out the uses of an
    // order that is being saved again.
    public static async Task<Loaded> LoadAsync(
        WTFDbContext db,
        DateTime referenceUtc,
        TimeZoneInfo timeZone,
        Guid? exceptOrderId,
        CancellationToken cancellationToken)
    {
        var promotions = await db.Promotions
            .Where(p => p.TypeId == PromotionTypeIds.DiscountedProduct)
            .Include(p => p.DiscountedProductPromotions)
                .ThenInclude(d => d.DiscountedProductPromotionAddOns)
            .ToListAsync(cancellationToken);

        var live = promotions
            .Where(p => PromotionPricing.IsPromotionActiveOnLocalDate(p, referenceUtc, timeZone))
            .ToList();

        var limited = live.Where(p => p.MaxRedemptions.HasValue).ToList();
        var used = await PromotionUsage.CountAsync(db, [.. limited.Select(p => p.Id)], exceptOrderId, cancellationToken);
        var budget = new DiscountBudget(limited.ToDictionary(
            p => p.Id,
            p => Math.Max(0, p.MaxRedemptions!.Value - used[p.Id])));

        var rules = live
            .SelectMany(p => p.DiscountedProductPromotions.Select(d => (Promotion: p, Rule: d)))
            .GroupBy(x => x.Rule.ProductId)
            .ToDictionary(
                g => g.Key,
                g => g.Select(x => new PromotionPricing.DiscountedRule(
                    x.Rule.FixedPrice,
                    x.Rule.PercentOff,
                    [.. x.Rule.DiscountedProductPromotionAddOns.Select(a => (a.AddOnProductId, a.Quantity))],
                    x.Promotion.Id)).ToList());

        return new Loaded(rules, budget);
    }
}
