using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Time;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Promotions;

public record EvaluatePromotionsCommand(EvaluatePromotionsRequestDto Request) : IRequest<EvaluatePromotionsResponseDto>;

public sealed class EvaluatePromotionsHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<EvaluatePromotionsCommand, EvaluatePromotionsResponseDto>
{
    public async Task<EvaluatePromotionsResponseDto> Handle(EvaluatePromotionsCommand request, CancellationToken cancellationToken)
    {
        var now = (request.Request.EvaluatedAtUtc ?? DateTime.UtcNow).ToUniversalTime();
        var workingLines = request.Request.Lines
            .Where(x => !x.IsPromoLine)
            .Where(x => x.Quantity > 0)
            .Select(Clone)
            .ToList();

        // Same rule the order is saved with: start and end are calendar days in the shop's time zone.
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var scheduledPromotions = await db.Promotions
            .Where(x => x.IsActive)
            .Include(x => x.FixedBundlePromotion!)
                .ThenInclude(x => x.FixedBundlePromotionItems)
                    .ThenInclude(x => x.FixedBundlePromotionItemAddOns)
            .Include(x => x.DiscountedProductPromotions)
                .ThenInclude(x => x.DiscountedProductPromotionAddOns)
            .ToListAsync(cancellationToken);
        var activePromotions = scheduledPromotions
            .Where(x => PromotionPricing.IsPromotionActiveOnLocalDate(x, now, timeZone))
            .ToList();

        var generated = new List<PromotionCartLineDto>();

        ApplyFixedBundles(workingLines, generated, activePromotions.Where(x => x.TypeId == PromotionTypeIds.FixedBundle));
        ApplyDiscountedProducts(workingLines, activePromotions.Where(x => x.TypeId == PromotionTypeIds.DiscountedProduct));

        var output = workingLines
            .Where(x => x.Quantity > 0)
            .Concat(generated)
            .ToList();

        return new EvaluatePromotionsResponseDto(output);
    }

    internal static void ApplyDiscountedProducts(List<PromotionCartLineDto> workingLines, IEnumerable<Promotion> promos)
    {
        var promosByProduct = promos
            .SelectMany(promo => promo.DiscountedProductPromotions
                .Select(item => (promo, item)))
            .GroupBy(x => x.item.ProductId)
            .ToDictionary(x => x.Key, x => x.ToList());

        foreach (var line in workingLines)
        {
            // A locked line already carries its final price and a free item is free: neither is discounted again.
            if (line.IsLocked || line.IsFreeItem)
            {
                continue;
            }

            if (!promosByProduct.TryGetValue(line.ProductId, out var candidates))
            {
                continue;
            }

            Promotion? selectedPromo = null;
            decimal? bestUnitPrice = null;

            foreach (var promo in candidates)
            {
                var discounted = promo.item;

                if (!SatisfiesExactAddOns(line, discounted.DiscountedProductPromotionAddOns.Select(a => (a.AddOnProductId, a.Quantity))))
                {
                    continue;
                }

                var proposed = PromotionPricing.CalculateDiscountedUnitPrice(line.UnitPrice, discounted.FixedPrice, discounted.PercentOff);
                if (!proposed.HasValue)
                {
                    continue;
                }

                if (!bestUnitPrice.HasValue || proposed.Value < bestUnitPrice.Value)
                {
                    bestUnitPrice = proposed.Value;
                    selectedPromo = promo.promo;
                }
            }

            if (bestUnitPrice.HasValue && selectedPromo is not null)
            {
                line.UnitPrice = bestUnitPrice.Value;
                line.PromotionId = selectedPromo.Id;
            }
        }
    }

    internal static void ApplyFixedBundles(List<PromotionCartLineDto> workingLines, List<PromotionCartLineDto> generated, IEnumerable<Promotion> promos)
    {
        foreach (var promo in promos)
        {
            var bundle = promo.FixedBundlePromotion;
            if (bundle is null || bundle.FixedBundlePromotionItems.Count == 0)
            {
                continue;
            }

            var specs = bundle.FixedBundlePromotionItems.ToList();
            var bundleCount = specs
                .Select(spec =>
                {
                    var available = workingLines
                        .Where(x => !x.IsFreeItem && x.ProductId == spec.ProductId)
                        .Where(x => SatisfiesRequiredAddOns(x, spec.FixedBundlePromotionItemAddOns.Select(a => (a.AddOnProductId, a.Quantity))))
                        .Sum(x => x.Quantity);
                    return available / spec.Quantity;
                })
                .DefaultIfEmpty(0)
                .Min();

            if (bundleCount <= 0)
            {
                continue;
            }

            for (var bundleIndex = 0; bundleIndex < bundleCount; bundleIndex++)
            {
                var parentSpec = specs[0];
                var parentTrigger = ConsumeQuantity(workingLines, parentSpec.ProductId, parentSpec.Quantity,
                    parentSpec.FixedBundlePromotionItemAddOns.Select(a => (a.AddOnProductId, a.Quantity)));

                if (parentTrigger is null)
                {
                    break;
                }

                var parentLineId = Guid.NewGuid().ToString("N");
                generated.Add(new PromotionCartLineDto
                {
                    LineId = parentLineId,
                    ProductId = parentSpec.ProductId,
                    Quantity = 1,
                    UnitPrice = bundle.BundlePrice,
                    AddOns = [],
                    IsPromoLine = true,
                    IsFreeItem = false,
                    BundleParentId = null,
                    TriggerLineId = parentTrigger.LineId,
                    PromotionId = promo.Id,
                    IsLocked = true
                });

                foreach (var spec in specs)
                {
                    var trigger = spec == parentSpec
                        ? parentTrigger
                        : ConsumeQuantity(workingLines, spec.ProductId, spec.Quantity,
                            spec.FixedBundlePromotionItemAddOns.Select(a => (a.AddOnProductId, a.Quantity)));

                    if (trigger is null)
                    {
                        continue;
                    }

                    var addOns = spec.FixedBundlePromotionItemAddOns
                        .Select(x => new PromotionCartAddOnLineDto
                        {
                            AddOnProductId = x.AddOnProductId,
                            Quantity = x.Quantity
                        })
                        .ToList();

                    generated.Add(new PromotionCartLineDto
                    {
                        LineId = Guid.NewGuid().ToString("N"),
                        ProductId = spec.ProductId,
                        Quantity = spec.Quantity,
                        UnitPrice = 0m,
                        AddOns = addOns,
                        IsPromoLine = true,
                        IsFreeItem = false,
                        BundleParentId = parentLineId,
                        TriggerLineId = trigger.LineId,
                        PromotionId = promo.Id,
                        IsLocked = true
                    });
                }
            }
        }
    }

    internal static PromotionCartLineDto? ConsumeQuantity(
        List<PromotionCartLineDto> lines,
        Guid productId,
        int requiredQty,
        IEnumerable<(Guid AddOnProductId, int Quantity)> requiredAddOns)
    {
        // Free items are never consumed: ApplyFixedBundles counts bundles from non-free lines only, so consuming a
        // free line here would use it up instead of the paid line the bundle was counted from.
        var candidates = lines
            .Where(x => x.ProductId == productId && x.Quantity > 0 && !x.IsFreeItem)
            .Where(x => SatisfiesRequiredAddOns(x, requiredAddOns))
            .OrderByDescending(x => x.Quantity)
            .ToList();

        var remaining = requiredQty;
        PromotionCartLineDto? first = null;

        foreach (var line in candidates)
        {
            if (remaining <= 0)
            {
                break;
            }

            var consume = Math.Min(remaining, line.Quantity);
            line.Quantity -= consume;
            remaining -= consume;
            first ??= line;
        }

        lines.RemoveAll(x => x.Quantity <= 0);
        return remaining == 0 ? first : null;
    }

    internal static bool SatisfiesRequiredAddOns(
        PromotionCartLineDto line,
        IEnumerable<(Guid AddOnProductId, int Quantity)> requiredAddOns)
    {
        var addOnMap = line.AddOns
            .GroupBy(x => x.AddOnProductId)
            .ToDictionary(x => x.Key, x => x.Sum(y => y.Quantity));

        foreach (var (addOnProductId, quantity) in requiredAddOns)
        {
            if (!addOnMap.TryGetValue(addOnProductId, out var qty) || qty < quantity)
            {
                return false;
            }
        }

        return true;
    }

    internal static bool SatisfiesExactAddOns(
        PromotionCartLineDto line,
        IEnumerable<(Guid AddOnProductId, int Quantity)> requiredAddOns)
    {
        var addOnMap = line.AddOns
            .GroupBy(x => x.AddOnProductId)
            .ToDictionary(x => x.Key, x => x.Sum(y => y.Quantity));

        return PromotionPricing.SatisfiesExactAddOns(addOnMap, requiredAddOns);
    }

    internal static PromotionCartLineDto Clone(PromotionCartLineDto line)
    {
        return new PromotionCartLineDto
        {
            LineId = line.LineId,
            ProductId = line.ProductId,
            Quantity = line.Quantity,
            UnitPrice = line.UnitPrice,
            AddOns = [.. line.AddOns.Select(x => new PromotionCartAddOnLineDto
            {
                AddOnProductId = x.AddOnProductId,
                Quantity = x.Quantity
            })],
            IsPromoLine = line.IsPromoLine,
            IsFreeItem = line.IsFreeItem,
            BundleParentId = line.BundleParentId,
            TriggerLineId = line.TriggerLineId,
            PromotionId = line.PromotionId,
            IsLocked = line.IsLocked
        };
    }
}
