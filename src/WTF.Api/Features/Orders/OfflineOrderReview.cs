using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Orders;
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
        var found = await FindAsync(db, command, timeZone, cancellationToken);
        return [.. found.Select(r => r.Text).Distinct()];
    }

    public static async Task<List<OfflineReason>> FindAsync(
        WTFDbContext db,
        CreateOrderCommand command,
        TimeZoneInfo timeZone,
        CancellationToken cancellationToken)
    {
        var reasons = new List<OfflineReason>();
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
            .OrderBy(p => p.Name, StringComparer.Ordinal)
            .Select(p => OfflineReason.Hold(OfflineReasonCodes.ProductInactive, $"{p.Name} is inactive.")));

        if (command.CustomerId.HasValue)
        {
            var customer = await db.Customers
                .Where(c => c.Id == command.CustomerId.Value)
                .Select(c => new { c.FirstName, c.LastName, c.IsActive })
                .FirstOrDefaultAsync(cancellationToken);
            if (customer is { IsActive: false })
            {
                reasons.Add(OfflineReason.Hold(OfflineReasonCodes.CustomerInactive, $"Customer {customer.FirstName} {customer.LastName} is inactive."));
            }
        }

        await AddBundleReasonsAsync(db, command, createdAt, timeZone, reasons, cancellationToken);
        await AddSeniorPwdReasonsAsync(db, command, reasons, cancellationToken);
        await AddPriceReasonsAsync(db, command, products.ToDictionary(p => p.Key, p => (p.Value.Name, p.Value.Price)), createdAt, timeZone, reasons, cancellationToken);

        return [.. reasons.Distinct()];
    }

    // The register worked out the Senior/PWD discount with the shop settings it had. A person without an ID or name, or a
    // setting that changed while the device was offline, holds the sale for an Admin instead of failing it.
    private static async Task AddSeniorPwdReasonsAsync(
        WTFDbContext db,
        CreateOrderCommand command,
        List<OfflineReason> reasons,
        CancellationToken cancellationToken)
    {
        if (command.SeniorPwdPersons.Count == 0)
        {
            return;
        }

        if (command.SeniorPwdPersons.Any(p => string.IsNullOrWhiteSpace(p.IdNumber) || string.IsNullOrWhiteSpace(p.CustomerName)))
        {
            reasons.Add(OfflineReason.Hold(OfflineReasonCodes.SeniorPwdIdMissing, "A Senior/PWD discount is missing the ID number or the name on the ID."));
        }

        await AddSeniorPwdLineReasonsAsync(db, command, reasons, cancellationToken);

        var settings = await db.TenantSettings
            .AsNoTracking()
            .Select(s => new { s.SeniorPwdEnabled, s.VatRegistered })
            .FirstOrDefaultAsync(cancellationToken);
        if (settings is not { SeniorPwdEnabled: true })
        {
            reasons.Add(OfflineReason.Hold(OfflineReasonCodes.SeniorPwdDisabled, "The Senior/PWD discount is now turned off for this shop."));
            return;
        }

        if (command.ExpectedTotal is null
            || command.Items.Any(i => i.QuotedPrice is null || i.AddOns.Any(a => a.QuotedPrice is null))
            || command.BundlePromotions.Any(b => b.QuotedUnitPrice is null))
        {
            return;
        }

        var quotedTotal = command.Items.Sum(i => (i.QuotedPrice!.Value + i.AddOns.Sum(a => a.QuotedPrice!.Value * a.Quantity)) * i.Quantity)
            + command.BundlePromotions.Sum(b => b.QuotedUnitPrice!.Value * b.Quantity);
        var shownReduction = quotedTotal - command.ExpectedTotal.Value;
        var currentReduction = command.Items
            .Where(i => i.SeniorPwdPersonIndex.HasValue)
            .Sum(i => SeniorPwdRules.ForRow(
                (i.QuotedPrice!.Value + i.AddOns.Sum(a => a.QuotedPrice!.Value * a.Quantity)) * i.Quantity,
                settings.VatRegistered).Reduction);
        if (shownReduction != currentReduction)
        {
            reasons.Add(OfflineReason.Hold(
                OfflineReasonCodes.SeniorPwdSettingsChanged,
                $"The Senior/PWD discount now comes to {currentReduction:0.00}, the register showed {shownReduction:0.00}.",
                null,
                $"{currentReduction:0.00}",
                $"{shownReduction:0.00}"));
        }
    }

    // A promotion price, a bundle and a product that is not food or drink can never take the discount. The register keeps
    // those lines from being covered, so a covered one here means the promotion or the product changed while it was offline.
    private static async Task AddSeniorPwdLineReasonsAsync(
        WTFDbContext db,
        CreateOrderCommand command,
        List<OfflineReason> reasons,
        CancellationToken cancellationToken)
    {
        var coveredItems = command.Items.Where(i => i.SeniorPwdPersonIndex.HasValue).ToList();
        var coveredIds = coveredItems.Select(i => i.ProductId).Distinct().ToList();
        var products = await db.Products
            .Where(p => coveredIds.Contains(p.Id))
            .Select(p => new { p.Id, p.Name, p.IsSeniorPwdEligible })
            .ToDictionaryAsync(p => p.Id, cancellationToken);

        foreach (var item in coveredItems)
        {
            var name = products.TryGetValue(item.ProductId, out var product) ? product.Name : "An item";
            if (product is { IsSeniorPwdEligible: false })
            {
                reasons.Add(OfflineReason.Hold(OfflineReasonCodes.SeniorPwdOnPromotion, $"{name} is not food or drink, so it cannot take the Senior/PWD discount."));
            }
            else if (item.BundlePromotionId.HasValue)
            {
                reasons.Add(OfflineReason.Hold(OfflineReasonCodes.SeniorPwdOnPromotion, $"{name} is part of a bundle, so it cannot take the Senior/PWD discount."));
            }
            else if (item.QuotedPrice < item.QuotedOriginalPrice || !string.IsNullOrWhiteSpace(item.QuotedPromoLabel))
            {
                reasons.Add(OfflineReason.Hold(OfflineReasonCodes.SeniorPwdOnPromotion, $"{name} had a promotion price, so it cannot take the Senior/PWD discount."));
            }
        }
    }

    private static async Task AddBundleReasonsAsync(
        WTFDbContext db,
        CreateOrderCommand command,
        DateTime createdAt,
        TimeZoneInfo timeZone,
        List<OfflineReason> reasons,
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

        reasons.AddRange(problems.Select(p => OfflineReason.Hold(OfflineReasonCodes.BundleChanged, p)));

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
                reasons.Add(OfflineReason.Hold(
                    OfflineReasonCodes.BundleChanged,
                    $"Bundle '{names[bundle.PromotionId]}' now costs {current:0.00}, quoted {bundle.QuotedUnitPrice.Value:0.00}.",
                    null,
                    $"{current:0.00}",
                    $"{bundle.QuotedUnitPrice.Value:0.00}"));
            }
        }
    }

    private static async Task AddPriceReasonsAsync(
        WTFDbContext db,
        CreateOrderCommand command,
        Dictionary<Guid, (string Name, decimal Price)> products,
        DateTime createdAt,
        TimeZoneInfo timeZone,
        List<OfflineReason> reasons,
        CancellationToken cancellationToken)
    {
        var parentIds = command.Items.Select(i => i.ProductId).Distinct().ToList();
        var overridePrices = await db.ProductAddOnPriceOverrides
            .Where(o => o.IsActive && parentIds.Contains(o.ProductId))
            .ToDictionaryAsync(o => (o.ProductId, o.AddOnId), o => o.Price, cancellationToken);

        var loaded = await DiscountRuleLoader.LoadAsync(db, createdAt, timeZone, null, cancellationToken);
        var rulesByProductId = loaded.RulesByProductId;

        for (var lineIndex = 0; lineIndex < command.Items.Count; lineIndex++)
        {
            var item = command.Items[lineIndex];
            if (!products.TryGetValue(item.ProductId, out var product))
            {
                continue;
            }

            if (!item.BundlePromotionId.HasValue)
            {
                var discounted = PromotionPricing.GetDiscountedUnitPrice(
                    product.Price,
                    item.ProductId,
                    item.AddOns.Select(a => (a.ProductId, a.Quantity)),
                    rulesByProductId,
                    item.Quantity,
                    loaded.Budget);
                loaded.Budget.Use(discounted?.PromotionId, discounted?.DiscountedQuantity ?? 0);

                if (discounted is { IsPartial: true } && item.QuotedPrice.HasValue)
                {
                    // A limit now covers only part of the line, so no single quoted price can match it.
                    reasons.Add(OfflineReason.Hold(
                        OfflineReasonCodes.PromotionOverLimit,
                        $"{product.Name}: the promotion now covers only {discounted.DiscountedQuantity} of {item.Quantity}.",
                        lineIndex,
                        $"{discounted.DiscountedQuantity}",
                        $"{item.Quantity}"));
                }
                else
                {
                    var current = discounted?.Price ?? product.Price;
                    if (item.QuotedPrice.HasValue && current != item.QuotedPrice.Value)
                    {
                        reasons.Add(OfflineReason.Hold(
                            OfflineReasonCodes.PriceChanged,
                            $"{product.Name} now costs {current:0.00}, quoted {item.QuotedPrice.Value:0.00}.",
                            lineIndex,
                            $"{current:0.00}",
                            $"{item.QuotedPrice.Value:0.00}"));
                    }
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
                    reasons.Add(OfflineReason.Hold(
                        OfflineReasonCodes.AddOnPriceChanged,
                        $"{addOnProduct.Name} on {product.Name} now costs {currentAddOn:0.00}, quoted {addOn.QuotedPrice.Value:0.00}.",
                        lineIndex,
                        $"{currentAddOn:0.00}",
                        $"{addOn.QuotedPrice.Value:0.00}"));
                }
            }
        }
    }
}
