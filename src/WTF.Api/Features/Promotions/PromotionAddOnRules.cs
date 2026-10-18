using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Products.Enums;
using WTF.Domain.Data;

namespace WTF.Api.Features.Promotions;

internal static class PromotionAddOnRules
{
    // An order for a product with a Size or Flavor add-on must pick exactly one of each, and at most one Sauce. A
    // promotion that lists the add-ons of a product has to follow the same rules, or no order could ever match it and
    // the promotion could be saved but never sold. A product with only optional add-ons (or none) may list none.
    public static async Task EnsureRequiredTypesAsync(
        WTFDbContext db,
        IReadOnlyCollection<(Guid ProductId, IReadOnlyCollection<Guid> AddOnIds)> items,
        CancellationToken cancellationToken)
    {
        if (items.Count == 0)
        {
            return;
        }

        var productIds = items.Select(i => i.ProductId).Distinct().ToList();
        var links = await db.ProductAddOns
            .Where(x => x.IsActive && productIds.Contains(x.ProductId))
            .Select(x => new { x.ProductId, x.AddOnId, x.AddOnTypeId })
            .ToListAsync(cancellationToken);
        var names = await db.Products
            .Where(p => productIds.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => p.Name, cancellationToken);

        foreach (var (productId, addOnIds) in items)
        {
            var typeByAddOn = links
                .Where(x => x.ProductId == productId)
                .GroupBy(x => x.AddOnId)
                .ToDictionary(g => g.Key, g => (AddOnTypeEnum)(g.First().AddOnTypeId ?? (int)AddOnTypeEnum.Extra));
            var productName = names.TryGetValue(productId, out var name) ? name : "A product";

            foreach (var required in new[] { AddOnTypeEnum.Size, AddOnTypeEnum.Flavor })
            {
                if (!typeByAddOn.ContainsValue(required))
                {
                    continue;
                }

                var chosen = addOnIds.Distinct().Count(id => typeByAddOn.TryGetValue(id, out var type) && type == required);
                if (chosen != 1)
                {
                    throw new InvalidOperationException(
                        $"{productName} needs exactly one {required} add-on in this promotion, because every order for it has one.");
                }
            }

            var sauces = addOnIds.Distinct().Count(id => typeByAddOn.TryGetValue(id, out var type) && type == AddOnTypeEnum.Sauce);
            if (sauces > 1)
            {
                throw new InvalidOperationException($"{productName} can have at most one Sauce add-on in this promotion.");
            }
        }
    }
}
