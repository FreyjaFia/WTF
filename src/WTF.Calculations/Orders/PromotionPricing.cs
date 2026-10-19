using WTF.Domain.Entities;

namespace WTF.Calculations.Orders;

/// <summary>
/// The one copy of the discounted-product pricing rules, shared by creating an order, updating an order and the
/// cart preview so the preview and the saved order can never disagree on a price.
/// </summary>
public static class PromotionPricing
{
    public static bool IsPromotionActiveOnLocalDate(Promotion promotion, DateTime utcReference, TimeZoneInfo timeZone)
    {
        if (!promotion.IsActive)
        {
            return false;
        }

        var localNow = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utcReference, DateTimeKind.Utc), timeZone);
        var localDate = localNow.Date;

        var startLocalDate = promotion.StartDate.HasValue
            ? TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(promotion.StartDate.Value, DateTimeKind.Utc), timeZone).Date
            : (DateTime?)null;
        var endLocalDate = promotion.EndDate.HasValue
            ? TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(promotion.EndDate.Value, DateTimeKind.Utc), timeZone).Date
            : (DateTime?)null;

        if (startLocalDate.HasValue && localDate < startLocalDate.Value)
        {
            return false;
        }

        if (endLocalDate.HasValue && localDate > endLocalDate.Value)
        {
            return false;
        }

        return PromotionSchedule.IsOpen(promotion.DaysOfWeek, promotion.StartTime, promotion.EndTime, localNow);
    }

    public sealed record DiscountedRule(
        decimal? FixedPrice,
        decimal? PercentOff,
        List<(Guid AddOnProductId, int Quantity)> RequiredAddOns,
        Guid? PromotionId = null,
        int? MaxPerOrder = null);

    public sealed record AppliedDiscount(
        decimal Price,
        string? Label,
        Guid? PromotionId = null,
        decimal? FixedPrice = null,
        decimal? PercentOff = null,
        decimal BasePrice = 0m,
        int DiscountedQuantity = 1,
        int RequestedQuantity = 1)
    {
        // A limit can cover only part of a line: the rest is charged full price.
        public bool IsPartial => DiscountedQuantity < RequestedQuantity;

        // The label for a line whose add-ons cost this much per item (Label assumes none).
        public string? LabelWith(decimal addOnsPerUnit) =>
            PromotionLabelFormatter.Format(FixedPrice, PercentOff, BasePrice, addOnsPerUnit);
    }

    public static AppliedDiscount? GetDiscountedUnitPrice(
        decimal basePrice,
        Guid productId,
        IEnumerable<(Guid AddOnProductId, int Quantity)> cartAddOns,
        Dictionary<Guid, List<DiscountedRule>> rulesByProductId,
        int quantity = 1,
        DiscountBudget? budget = null)
    {
        if (!rulesByProductId.TryGetValue(productId, out var rules) || rules.Count == 0)
        {
            return null;
        }

        var addOnMap = cartAddOns
            .GroupBy(x => x.AddOnProductId)
            .ToDictionary(x => x.Key, x => x.Sum(y => y.Quantity));

        AppliedDiscount? best = null;
        foreach (var rule in rules)
        {
            if (!SatisfiesExactAddOns(addOnMap, rule.RequiredAddOns))
            {
                continue;
            }

            // A limited promotion discounts only as many items as this order can still take (uses left, and the most one
            // order may have); a line above that pays full price for the rest.
            var available = budget?.Available(rule.PromotionId);
            if (available == 0)
            {
                continue;
            }

            var discountedQuantity = available is null ? quantity : Math.Min(quantity, available.Value);

            var discounted = CalculateDiscountedUnitPrice(basePrice, rule.FixedPrice, rule.PercentOff);
            if (!discounted.HasValue)
            {
                continue;
            }

            // The rule that saves the most on this line wins; at the same saving the lower price does.
            var saving = (basePrice - discounted.Value) * discountedQuantity;
            var bestSaving = best is null ? -1m : (basePrice - best.Price) * best.DiscountedQuantity;
            if (best is null || saving > bestSaving || (saving == bestSaving && discounted.Value < best.Price))
            {
                best = new AppliedDiscount(
                    discounted.Value,
                    PromotionLabelFormatter.Format(rule.FixedPrice, rule.PercentOff, basePrice),
                    rule.PromotionId,
                    rule.FixedPrice,
                    rule.PercentOff,
                    basePrice,
                    discountedQuantity,
                    quantity);
            }
        }

        return best;
    }

    public static bool SatisfiesExactAddOns(
        Dictionary<Guid, int> addOnMap,
        IEnumerable<(Guid AddOnProductId, int Quantity)> requiredAddOns)
    {
        // A rule that lists no add-ons is for the plain product: it applies only when the item has no add-ons at all.
        var required = requiredAddOns.ToList();
        var requiredSet = required.Select(x => x.AddOnProductId).ToHashSet();
        foreach (var (addOnProductId, quantity) in required)
        {
            if (!addOnMap.TryGetValue(addOnProductId, out var qty) || qty != quantity)
            {
                return false;
            }
        }

        foreach (var entry in addOnMap)
        {
            if (!requiredSet.Contains(entry.Key) && entry.Value > 0)
            {
                return false;
            }
        }

        return true;
    }

    public static decimal? CalculateDiscountedUnitPrice(decimal basePrice, decimal? fixedPrice, decimal? percentOff)
    {
        if (fixedPrice.HasValue && fixedPrice.Value > 0)
        {
            var discounted = basePrice - fixedPrice.Value;
            return Math.Max(0, discounted);
        }

        if (percentOff.HasValue && percentOff.Value > 0)
        {
            var multiplier = 1m - (percentOff.Value / 100m);
            var discounted = basePrice * multiplier;
            // A discount of more than 100% never takes the price below zero (the fixed-price branch clamps the same way).
            return Math.Max(0m, Math.Round(discounted, 2, MidpointRounding.AwayFromZero));
        }

        return null;
    }
}
