using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Promotions;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Domain.Entities;

namespace WTF.Tests.Features.Pricing;

/// <summary>A promotion rule described independently of the three handler-specific record types.</summary>
internal sealed record RuleSpec(decimal? FixedPrice, decimal? PercentOff, params (Guid AddOnId, int Qty)[] AddOns);

/// <summary>
/// Adapters that run the same inputs through every duplicated copy of a pricing helper
/// (CreateOrderHandler, UpdateOrderHandler, EvaluatePromotionsHandler).
/// </summary>
internal static class PricingCopies
{
    public static readonly Guid Product = new("11111111-0000-0000-0000-000000000001");
    public static readonly Guid AddOnA = new("22222222-0000-0000-0000-000000000001");
    public static readonly Guid AddOnB = new("22222222-0000-0000-0000-000000000002");
    public static readonly Guid AddOnC = new("22222222-0000-0000-0000-000000000003");

    public static readonly string[] CopyNames = ["Create", "Update", "Evaluate"];

    public static decimal? Calculate(string copy, decimal basePrice, decimal? fixedPrice, decimal? percentOff) => copy switch
    {
        "Create" => CreateOrderHandler.CalculateDiscountedUnitPrice(basePrice, fixedPrice, percentOff),
        "Update" => UpdateOrderHandler.CalculateDiscountedUnitPrice(basePrice, fixedPrice, percentOff),
        "Evaluate" => EvaluatePromotionsHandler.CalculateDiscountedUnitPrice(basePrice, fixedPrice, percentOff),
        _ => throw new ArgumentOutOfRangeException(nameof(copy))
    };

    public static bool SatisfiesExact(string copy, (Guid AddOnId, int Qty)[] cartAddOns, (Guid AddOnId, int Qty)[] required)
    {
        var req = required.Select(r => (r.AddOnId, r.Qty)).ToList();
        var map = cartAddOns.GroupBy(a => a.AddOnId).ToDictionary(g => g.Key, g => g.Sum(x => x.Qty));
        return copy switch
        {
            "Create" => CreateOrderHandler.SatisfiesExactAddOns(map, req),
            "Update" => UpdateOrderHandler.SatisfiesExactAddOns(map, req),
            "Evaluate" => EvaluatePromotionsHandler.SatisfiesExactAddOns(Line(cartAddOns), req),
            _ => throw new ArgumentOutOfRangeException(nameof(copy))
        };
    }

    /// <summary>Only the Create/Update copies have GetDiscountedUnitPrice; the Evaluate handler inlines it in ApplyDiscountedProducts.</summary>
    public static (decimal Price, string? Label)? GetDiscounted(
        string copy, decimal basePrice, (Guid AddOnId, int Qty)[] cartAddOns, params RuleSpec[] rules)
    {
        var item = new OrderItemRequestDto(
            Product, 1,
            cartAddOns.Select(a => new OrderItemRequestDto(a.AddOnId, a.Qty, [], null, null)).ToList(),
            null, null);

        switch (copy)
        {
            case "Create":
            {
                var dict = new Dictionary<Guid, List<CreateOrderHandler.DiscountedRule>>
                {
                    [Product] = rules.Select(r => new CreateOrderHandler.DiscountedRule(r.FixedPrice, r.PercentOff, r.AddOns.ToList())).ToList()
                };
                var r = CreateOrderHandler.GetDiscountedUnitPrice(basePrice, item, dict);
                return r is null ? null : (r.Price, r.Label);
            }
            case "Update":
            {
                var dict = new Dictionary<Guid, List<UpdateOrderHandler.DiscountedRule>>
                {
                    [Product] = rules.Select(r => new UpdateOrderHandler.DiscountedRule(r.FixedPrice, r.PercentOff, r.AddOns.ToList())).ToList()
                };
                var r = UpdateOrderHandler.GetDiscountedUnitPrice(basePrice, item, dict);
                return r is null ? null : (r.Price, r.Label);
            }
            default:
                throw new ArgumentOutOfRangeException(nameof(copy));
        }
    }

    public static PromotionCartLineDto Line((Guid AddOnId, int Qty)[]? addOns = null, Guid? productId = null, int qty = 1, decimal price = 100m, string? id = null) => new()
    {
        LineId = id ?? Guid.NewGuid().ToString("N"),
        ProductId = productId ?? Product,
        Quantity = qty,
        UnitPrice = price,
        AddOns = (addOns ?? []).Select(a => new PromotionCartAddOnLineDto { AddOnProductId = a.AddOnId, Quantity = a.Qty }).ToList()
    };

    public static bool IsActive(string copy, Promotion promo, DateTime utcReference, TimeZoneInfo tz) => copy switch
    {
        "Create" => CreateOrderHandler.IsPromotionActiveOnLocalDate(promo, utcReference, tz),
        "Update" => UpdateOrderHandler.IsPromotionActiveOnLocalDate(promo, utcReference, tz),
        _ => throw new ArgumentOutOfRangeException(nameof(copy))
    };
}
