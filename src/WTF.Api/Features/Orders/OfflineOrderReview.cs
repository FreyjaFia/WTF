using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Customers;
using WTF.Calculations.Orders;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

internal static class OfflineOrderReview
{
    private sealed record ReviewedProduct(Guid Id, string Name, decimal Price, bool IsActive, bool IsSeniorPwdEligible);

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
        CancellationToken cancellationToken,
        ITenantFeatures tenantFeatures,
        IHttpContextAccessor? httpContextAccessor = null)
    {
        var found = await FindAsync(db, command, timeZone, cancellationToken, tenantFeatures, httpContextAccessor);
        return [.. found.Select(r => r.Text).Distinct()];
    }

    public static async Task<List<OfflineReason>> FindAsync(
        WTFDbContext db,
        CreateOrderCommand command,
        TimeZoneInfo timeZone,
        CancellationToken cancellationToken,
        ITenantFeatures tenantFeatures,
        IHttpContextAccessor? httpContextAccessor = null)
    {
        var reasons = new List<OfflineReason>();
        var createdAt = command.CreatedAt?.ToUniversalTime() ?? DateTime.UtcNow;

        var productIds = command.Items
            .Select(i => i.ProductId)
            .Concat(command.Items.SelectMany(i => i.AddOns.Select(a => a.ProductId)))
            .Distinct()
            .ToList();
        var atSale = CatalogAtSale.Create(db, createdAt, command.CatalogSyncedAt?.ToUniversalTime());
        var current = await db.Products
            .Where(p => productIds.Contains(p.Id))
            .Select(p => new ReviewedProduct(p.Id, p.Name, p.Price, p.IsActive, p.IsSeniorPwdEligible))
            .ToListAsync(cancellationToken);
        var products = new Dictionary<Guid, ReviewedProduct>();
        foreach (var p in current)
        {
            products[p.Id] = p with
            {
                Price = await atSale.ProductPriceAsync(p.Id, p.Price, cancellationToken),
                IsActive = await atSale.ProductIsActiveAsync(p.Id, p.IsActive, cancellationToken)
            };
        }

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
                reasons.Add(OfflineReason.Hold(OfflineReasonCodes.CustomerInactive, $"Customer {CustomerName.Join(customer.FirstName, customer.LastName)} is inactive."));
            }
        }

        await AddBundleReasonsAsync(db, command, createdAt, timeZone, reasons, cancellationToken, tenantFeatures);
        await AddSeniorPwdReasonsAsync(db, command, products, httpContextAccessor, reasons, cancellationToken);
        await AddPriceReasonsAsync(db, command, products.ToDictionary(p => p.Key, p => (p.Value.Name, p.Value.Price)), atSale, createdAt, timeZone, reasons, cancellationToken, tenantFeatures);

        return [.. reasons.Distinct()];
    }

    private static async Task AddSeniorPwdReasonsAsync(
        WTFDbContext db,
        CreateOrderCommand command,
        Dictionary<Guid, ReviewedProduct> products,
        IHttpContextAccessor? httpContextAccessor,
        List<OfflineReason> reasons,
        CancellationToken cancellationToken)
    {
        if (command.SeniorPwdPersons.Count == 0)
        {
            return;
        }

        // A held order skips the permission check that blocks a live order, so a cashier without it is flagged here.
        if (httpContextAccessor is not null
            && !PermissionChecks.Has(httpContextAccessor.HttpContext?.User, PermissionKeys.OrdersSeniorPwdApply))
        {
            reasons.Add(OfflineReason.Hold(OfflineReasonCodes.SeniorPwdPermissionLost, "The Senior/PWD discount was submitted by a user without the permission to apply it."));
        }

        var ids = command.SeniorPwdPersons
            .Select(p => SeniorPwdRules.IdKey(p.IdNumber))
            .Where(id => id.Length > 0)
            .ToList();
        if (ids.Count != ids.Distinct().Count())
        {
            reasons.Add(OfflineReason.Hold(OfflineReasonCodes.SeniorPwdIdRepeated, "The same Senior/PWD ID number is used more than once on this order."));
        }

        if (command.SeniorPwdPersons.Any(p => string.IsNullOrWhiteSpace(p.IdNumber) || string.IsNullOrWhiteSpace(p.CustomerName)))
        {
            reasons.Add(OfflineReason.Hold(OfflineReasonCodes.SeniorPwdIdMissing, "A Senior/PWD discount is missing the ID number or the name on the ID."));
        }

        AddSeniorPwdLineReasons(command, products, reasons);

        var settings = await TenantSettingsLookup.LoadSeniorPwdAsync(db, cancellationToken);
        if (!settings.Enabled)
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

        var quotedLines = command.Items
            .Select(i => new QuotedLine(
                i.QuotedPrice!.Value,
                i.AddOns.Sum(a => a.QuotedPrice!.Value * a.Quantity),
                i.Quantity,
                i.SeniorPwdPersonIndex.HasValue))
            .ToList();
        var quotedTotal = OrderMetrics.QuotedTotal(
            quotedLines, command.BundlePromotions.Select(b => (b.QuotedUnitPrice!.Value, b.Quantity)));
        var shownReduction = OrderMetrics.ReductionShown(quotedTotal, command.ExpectedTotal.Value);
        var currentReduction = OrderMetrics.SeniorPwdReductionOf(quotedLines, settings.VatRegistered);
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
    private static void AddSeniorPwdLineReasons(
        CreateOrderCommand command,
        Dictionary<Guid, ReviewedProduct> products,
        List<OfflineReason> reasons)
    {
        foreach (var item in command.Items.Where(i => i.SeniorPwdPersonIndex.HasValue))
        {
            products.TryGetValue(item.ProductId, out var product);
            var hadPromotion = item.QuotedPrice < item.QuotedOriginalPrice || !string.IsNullOrWhiteSpace(item.QuotedPromoLabel);
            var reason = SeniorPwdReasons.Ineligible(
                product?.Name ?? "An item",
                product?.IsSeniorPwdEligible ?? true,
                hadPromotion,
                item.BundlePromotionId.HasValue);
            if (reason is not null)
            {
                reasons.Add(OfflineReason.Hold(OfflineReasonCodes.SeniorPwdOnPromotion, reason));
            }
        }
    }

    private static async Task AddBundleReasonsAsync(
        WTFDbContext db,
        CreateOrderCommand command,
        DateTime createdAt,
        TimeZoneInfo timeZone,
        List<OfflineReason> reasons,
        CancellationToken cancellationToken,
        ITenantFeatures tenantFeatures)
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
                db, command.BundlePromotions, command.Items, createdAt, timeZone, null, cancellationToken, tenantFeatures, problems);
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
        CatalogAtSale atSale,
        DateTime createdAt,
        TimeZoneInfo timeZone,
        List<OfflineReason> reasons,
        CancellationToken cancellationToken,
        ITenantFeatures tenantFeatures)
    {
        var parentIds = command.Items.Select(i => i.ProductId).Distinct().ToList();
        var overridePrices = await db.ProductAddOnPriceOverrides
            .Where(o => o.IsActive && parentIds.Contains(o.ProductId))
            .ToDictionaryAsync(o => (o.ProductId, o.AddOnId), o => o.Price, cancellationToken);

        var loaded = await DiscountRuleLoader.LoadAsync(db, createdAt, timeZone, null, cancellationToken, tenantFeatures);
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
                var addOnQuantities = item.AddOns.Select(a => (a.ProductId, a.Quantity)).ToList();
                var discounted = PromotionPricing.GetDiscountedUnitPrice(
                    product.Price, item.ProductId, addOnQuantities, rulesByProductId, item.Quantity, loaded.PoolFreeBudget);
                loaded.PoolFreeBudget.Use(discounted?.PromotionId, discounted?.DiscountedQuantity ?? 0);

                // The register could not see the shared pool of uses. The sale was charged, so it is honored; what the pool could
                // not cover is counted as over the limit and noted, never held.
                var withPool = PromotionPricing.GetDiscountedUnitPrice(
                    product.Price, item.ProductId, addOnQuantities, rulesByProductId, item.Quantity, loaded.Budget);
                loaded.Budget.Use(withPool?.PromotionId, withPool?.DiscountedQuantity ?? 0);
                var covered = discounted?.DiscountedQuantity ?? 0;
                var coveredByPool = withPool?.DiscountedQuantity ?? 0;
                if (discounted is not null && !discounted.IsPartial && item.QuotedPrice.HasValue && coveredByPool < covered && item.QuotedPrice.Value == discounted.Price)
                {
                    reasons.Add(OfflineReason.Note(
                        OfflineReasonCodes.PromotionOverLimit,
                        $"{product.Name}: the promotion had no uses left for {covered - coveredByPool} of {item.Quantity}, sold at the quoted price.",
                        lineIndex,
                        $"{coveredByPool}",
                        $"{covered}"));
                }

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

                overridePrices.TryGetValue((item.ProductId, addOn.ProductId), out var overridePrice);
                var overrideAtSale = await atSale.AddOnOverrideAsync(
                    item.ProductId, addOn.ProductId, overridePrices.ContainsKey((item.ProductId, addOn.ProductId)) ? overridePrice : null, cancellationToken);
                var currentAddOn = overrideAtSale ?? addOnProduct.Price;
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
