using Microsoft.EntityFrameworkCore;
using WTF.Calculations.Orders;
using WTF.Domain.Data;

namespace WTF.Api.Features.Promotions;

internal static class PromotionAddOnRules
{
    // An order must follow the selection rules of each add-on type the product offers (required, minimum, maximum). A
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

        var typeIds = links.Where(l => l.AddOnTypeId != null).Select(l => l.AddOnTypeId!.Value).Distinct().ToList();
        var rules = (await db.AddOnTypes
                .Where(t => typeIds.Contains(t.Id))
                .Select(t => new AddOnTypeRule(t.Id, t.Name, t.IsRequired, t.MinSelect, t.MaxSelect))
                .ToListAsync(cancellationToken))
            .ToDictionary(r => r.Id);

        foreach (var (productId, addOnIds) in items)
        {
            var productLinks = links.Where(x => x.ProductId == productId).ToList();
            var productName = names.TryGetValue(productId, out var name) ? name : "A product";
            var chosenIds = addOnIds.Distinct().ToHashSet();

            foreach (var rule in productLinks
                         .Where(l => l.AddOnTypeId != null && rules.ContainsKey(l.AddOnTypeId.Value))
                         .Select(l => rules[l.AddOnTypeId!.Value])
                         .Distinct()
                         .OrderBy(r => r.Id))
            {
                var chosen = productLinks
                    .Where(l => l.AddOnTypeId == rule.Id && chosenIds.Contains(l.AddOnId))
                    .Select(l => l.AddOnId)
                    .Distinct()
                    .Count();

                if (AddOnSelectionRules.Check(rule, chosen) is null)
                {
                    continue;
                }

                if (rule.Minimum == 1 && rule.MaxSelect == 1)
                {
                    throw new InvalidOperationException(
                        $"{productName} needs exactly one {rule.Name} add-on in this promotion, because every order for it has one.");
                }

                throw new InvalidOperationException(chosen > rule.Maximum
                    ? $"{productName} can have at most {(rule.Maximum == 1 ? "one" : rule.Maximum.ToString())} {rule.Name} add-on{(rule.Maximum == 1 ? string.Empty : "s")} in this promotion."
                    : $"{productName} needs at least {rule.Minimum} {rule.Name} add-on{(rule.Minimum == 1 ? string.Empty : "s")} in this promotion, because every order for it has them.");
            }
        }
    }
}
