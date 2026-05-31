using Microsoft.EntityFrameworkCore;
using WTF.Domain.Data;

namespace WTF.Api.Features.Promotions;

internal static class MixMatchValidation
{
    public static void EnsureValid(CreateMixMatchPromotionCommand request)
    {
        EnsureValidCore(
            request.Name,
            request.StartDate,
            request.EndDate,
            request.RequiredQuantity,
            request.MaxSelectionsPerOrder,
            request.BundlePrice,
            request.Items);
    }

    public static void EnsureValid(UpdateMixMatchPromotionCommand request)
    {
        EnsureValidCore(
            request.Name,
            request.StartDate,
            request.EndDate,
            request.RequiredQuantity,
            request.MaxSelectionsPerOrder,
            request.BundlePrice,
            request.Items);
    }

    private static void EnsureValidCore(
        string name,
        DateTime? startDate,
        DateTime? endDate,
        int requiredQuantity,
        int? maxSelectionsPerOrder,
        decimal bundlePrice,
        List<CreateMixMatchItemRequestDto> items)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new InvalidOperationException("Promotion name is required.");
        }

        if (endDate.HasValue && startDate.HasValue && endDate.Value < startDate.Value)
        {
            throw new InvalidOperationException("End date cannot be earlier than start date.");
        }

        if (requiredQuantity <= 0)
        {
            throw new InvalidOperationException("Required quantity must be greater than zero.");
        }

        if (maxSelectionsPerOrder.HasValue && maxSelectionsPerOrder.Value <= 0)
        {
            throw new InvalidOperationException("Max selections per order must be greater than zero.");
        }

        if (bundlePrice < 0)
        {
            throw new InvalidOperationException("Bundle price must be greater than or equal to zero.");
        }

        if (items.Count == 0)
        {
            throw new InvalidOperationException("At least one product is required.");
        }

        if (items.Select(x => x.ProductId).Distinct().Count() != items.Count)
        {
            throw new InvalidOperationException("Duplicate products are not allowed.");
        }

        if (items.Any(item => item.AddOns.Any(addOn => addOn.Quantity <= 0)))
        {
            throw new InvalidOperationException("Add-on quantity must be greater than zero.");
        }
    }

    public static async Task EnsureItemsAreLinkedAsync(
        WTFDbContext db,
        List<CreateMixMatchItemRequestDto> items,
        CancellationToken cancellationToken)
    {
        foreach (var item in items)
        {
            await EnsureLinkedForSingleProductAsync(
                db,
                item.ProductId,
                [.. item.AddOns.Select(x => x.AddOnProductId)],
                cancellationToken);
        }
    }

    private static async Task EnsureLinkedForSingleProductAsync(
        WTFDbContext db,
        Guid productId,
        List<Guid> addOnIds,
        CancellationToken cancellationToken)
    {
        if (addOnIds.Count == 0)
        {
            return;
        }

        var uniqueIds = addOnIds.Distinct().ToList();
        var allowed = await db.ProductAddOns
            .Where(x => x.ProductId == productId && uniqueIds.Contains(x.AddOnId))
            .Select(x => x.AddOnId)
            .ToListAsync(cancellationToken);

        var allowedSet = allowed.ToHashSet();
        if (uniqueIds.Any(x => !allowedSet.Contains(x)))
        {
            throw new InvalidOperationException("One or more add-ons are not linked to the selected product.");
        }
    }
}
