using Microsoft.EntityFrameworkCore;
using WTF.Domain.Data;

namespace WTF.Api.Features.Promotions;

internal static class DiscountedProductValidation
{
    public static void EnsureValid(
        string name,
        DateTime? startAtUtc,
        DateTime? endAtUtc,
        List<CreateDiscountedProductItemRequestDto> items)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new InvalidOperationException("Promotion name is required.");
        }

        if (endAtUtc.HasValue && startAtUtc.HasValue && endAtUtc.Value < startAtUtc.Value)
        {
            throw new InvalidOperationException("End date cannot be earlier than start date.");
        }

        if (items.Count == 0)
        {
            throw new InvalidOperationException("At least one discounted product is required.");
        }

        var duplicate = items
            .GroupBy(x => x.ProductId)
            .FirstOrDefault(x => x.Key != Guid.Empty && x.Count() > 1);
        if (duplicate is not null)
        {
            throw new InvalidOperationException("Each discounted product must be unique.");
        }

        foreach (var item in items)
        {
            var addOns = item.AddOns ?? [];
            if (item.ProductId == Guid.Empty)
            {
                throw new InvalidOperationException("Each discounted item must have a product.");
            }

            var hasFixed = item.FixedPrice.HasValue && item.FixedPrice.Value > 0;
            var hasPercent = item.PercentOff.HasValue && item.PercentOff.Value > 0;

            if (!hasFixed && !hasPercent)
            {
                throw new InvalidOperationException("Each discounted product must have a fixed price or percent discount.");
            }

            if (hasFixed && hasPercent)
            {
                throw new InvalidOperationException("Choose either a fixed price or percent discount, not both.");
            }

            if (item.PercentOff.HasValue && item.PercentOff.Value <= 0)
            {
                throw new InvalidOperationException("Percent discount must be greater than zero.");
            }

            if (item.PercentOff.HasValue && item.PercentOff.Value > 100)
            {
                throw new InvalidOperationException("Percent discount must be less than or equal to 100.");
            }

            if (item.FixedPrice.HasValue && item.FixedPrice.Value <= 0)
            {
                throw new InvalidOperationException("Fixed price must be greater than zero.");
            }

            if (addOns.Count == 0)
            {
                throw new InvalidOperationException("Select at least one required add-on for each discounted product.");
            }

            foreach (var addOn in addOns)
            {
                if (addOn.Quantity <= 0)
                {
                    throw new InvalidOperationException("Add-on quantity must be greater than zero.");
                }
            }
        }
    }

    public static async Task EnsureAddOnsAreLinkedAsync(
        WTFDbContext db,
        List<CreateDiscountedProductItemRequestDto> items,
        CancellationToken cancellationToken)
    {
        if (items.Count == 0)
        {
            return;
        }

        foreach (var item in items)
        {
            var addOns = item.AddOns ?? [];
            if (addOns.Count == 0)
            {
                continue;
            }

            var addOnIds = addOns.Select(x => x.AddOnProductId).Distinct().ToList();
            var allowed = await db.ProductAddOns
                .Where(x => x.ProductId == item.ProductId && addOnIds.Contains(x.AddOnId))
                .Select(x => x.AddOnId)
                .ToListAsync(cancellationToken);

            var allowedSet = allowed.ToHashSet();
            var invalid = addOns.FirstOrDefault(x => !allowedSet.Contains(x.AddOnProductId));

            if (invalid is not null)
            {
                throw new InvalidOperationException("One or more add-ons are not linked to the selected product.");
            }
        }
    }
}
