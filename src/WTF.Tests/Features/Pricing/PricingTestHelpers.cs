using WTF.Calculations.Orders;
using WTF.Domain.Entities;

namespace WTF.Tests.Features.Pricing;

/// <summary>A promotion rule described independently of the three handler-specific record types.</summary>
internal sealed record RuleSpec(decimal? FixedPrice, decimal? PercentOff, params (Guid AddOnId, int Qty)[] AddOns);

/// <summary>
/// Adapters that run test inputs through <see cref="PromotionPricing"/>, the one shared implementation of the pricing rules,.
/// </summary>
internal static class PricingTestHelpers
{
    public static readonly Guid Product = new("11111111-0000-0000-0000-000000000001");
    public static readonly Guid AddOnA = new("22222222-0000-0000-0000-000000000001");
    public static readonly Guid AddOnB = new("22222222-0000-0000-0000-000000000002");
    public static readonly Guid AddOnC = new("22222222-0000-0000-0000-000000000003");

    public static readonly string[] Implementations = ["Shared"];

    public static decimal? Calculate(decimal basePrice, decimal? fixedPrice, decimal? percentOff)
        => PromotionPricing.CalculateDiscountedUnitPrice(basePrice, fixedPrice, percentOff);

    public static bool SatisfiesExact(string implementation, (Guid AddOnId, int Qty)[] cartAddOns, (Guid AddOnId, int Qty)[] required)
    {
        var req = required.Select(r => (r.AddOnId, r.Qty)).ToList();
        var map = cartAddOns.GroupBy(a => a.AddOnId).ToDictionary(g => g.Key, g => g.Sum(x => x.Qty));
        return implementation switch
        {
            "Shared" => PromotionPricing.SatisfiesExactAddOns(map, req),
            _ => throw new ArgumentOutOfRangeException(nameof(implementation))
        };
    }

    public static (decimal Price, string? Label)? GetDiscounted(
        decimal basePrice, (Guid AddOnId, int Qty)[] cartAddOns, params RuleSpec[] rules)
    {

        var dict = new Dictionary<Guid, List<PromotionPricing.DiscountedRule>>
        {
            [Product] = rules.Select(r => new PromotionPricing.DiscountedRule(r.FixedPrice, r.PercentOff, r.AddOns.ToList())).ToList()
        };
        var result = PromotionPricing.GetDiscountedUnitPrice(basePrice, Product, cartAddOns, dict);
        return result is null ? null : (result.Price, result.Label);
    }

    public static bool IsActive(Promotion promo, DateTime utcReference, TimeZoneInfo tz)
        => PromotionPricing.IsPromotionActiveOnLocalDate(promo, utcReference, tz);
}
