using Microsoft.EntityFrameworkCore;
using WTF.Domain.Data;

namespace WTF.Api.Features.Promotions;

internal static class PromotionProductValidation
{
    public const int MaxNameLength = 100;

    public static void EnsureNameLength(string name)
    {
        if (name.Trim().Length > MaxNameLength)
        {
            throw new InvalidOperationException($"Promotion name must be {MaxNameLength} characters or fewer.");
        }
    }

    public static async Task EnsureUsableAsync(
        WTFDbContext db,
        IEnumerable<Guid> productIds,
        IEnumerable<Guid> addOnIds,
        bool requireActive,
        CancellationToken cancellationToken)
    {
        var parents = productIds.Distinct().ToList();
        var everything = parents.Concat(addOnIds).Distinct().ToList();

        var found = await db.Products
            .Where(p => everything.Contains(p.Id))
            .Select(p => new { p.Id, p.Name, p.IsActive, p.IsAddOn })
            .ToListAsync(cancellationToken);

        if (found.Count != everything.Count)
        {
            throw new InvalidOperationException("One or more promotion products or add-ons do not exist.");
        }

        // A promotion that is being switched off may still list products that have been deactivated since.
        if (requireActive)
        {
            var inactive = found.Where(p => !p.IsActive).Select(p => p.Name).Order().ToList();
            if (inactive.Count > 0)
            {
                throw new InvalidOperationException(
                    $"Inactive products cannot be used in a promotion: {string.Join(", ", inactive)}.");
            }
        }

        var addOnsAsProducts = found
            .Where(p => parents.Contains(p.Id) && p.IsAddOn)
            .Select(p => p.Name)
            .Order()
            .ToList();
        if (addOnsAsProducts.Count > 0)
        {
            throw new InvalidOperationException(
                $"Add-ons cannot be sold as promotion products: {string.Join(", ", addOnsAsProducts)}.");
        }
    }
}
