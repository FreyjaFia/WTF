using Microsoft.EntityFrameworkCore;
using WTF.Domain.Data;

namespace WTF.Api.Features.Promotions;

internal static class FixedBundleValidation
{
    public static void EnsureValid(
        string name,
        DateTime? startAtUtc,
        DateTime? endAtUtc,
        List<CreateFixedBundlePromotionItemRequestDto> items)
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
            throw new InvalidOperationException("At least one bundle item is required.");
        }

        foreach (var item in items)
        {
            if (item.Quantity <= 0)
            {
                throw new InvalidOperationException("Bundle item quantity must be greater than zero.");
            }

            foreach (var addOn in item.AddOns ?? [])
            {
                if (addOn.Quantity <= 0)
                {
                    throw new InvalidOperationException("Bundle add-on quantity must be greater than zero.");
                }
            }
        }
    }

    public static async Task EnsureAddOnsAreLinkedToBundleItemsAsync(
        WTFDbContext db,
        List<CreateFixedBundlePromotionItemRequestDto> items,
        CancellationToken cancellationToken)
    {
        var pairs = items
            .SelectMany(item => (item.AddOns ?? []).Select(addOn => new { item.ProductId, addOn.AddOnProductId }))
            .Distinct()
            .ToList();

        if (pairs.Count == 0)
        {
            return;
        }

        var productIds = pairs.Select(x => x.ProductId).Distinct().ToList();
        var addOnIds = pairs.Select(x => x.AddOnProductId).Distinct().ToList();
        var allowed = await db.ProductAddOns
            .Where(x => productIds.Contains(x.ProductId) && addOnIds.Contains(x.AddOnId))
            .Select(x => new { x.ProductId, x.AddOnId })
            .ToListAsync(cancellationToken);

        var allowedSet = allowed
            .Select(x => $"{x.ProductId}:{x.AddOnId}")
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var invalid = pairs
            .FirstOrDefault(x => !allowedSet.Contains($"{x.ProductId}:{x.AddOnProductId}"));

        if (invalid is not null)
        {
            throw new InvalidOperationException("One or more bundle add-ons are not linked to their parent product.");
        }
    }
}
