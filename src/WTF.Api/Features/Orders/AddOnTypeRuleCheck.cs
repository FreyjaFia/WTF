using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Orders.DTOs;
using WTF.Calculations.Orders;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

internal static class AddOnTypeRuleCheck
{
    public static async Task EnsureAsync(WTFDbContext db, Guid productId, List<OrderItemRequestDto> addOns, CancellationToken cancellationToken)
    {
        var links = await db.ProductAddOns
            .Where(pa => pa.IsActive && pa.ProductId == productId)
            .Select(pa => new { pa.AddOnId, pa.AddOnTypeId })
            .ToListAsync(cancellationToken);

        var typeIds = links.Where(l => l.AddOnTypeId != null).Select(l => l.AddOnTypeId!.Value).Distinct().ToList();
        var rules = (await db.AddOnTypes
                .Where(t => typeIds.Contains(t.Id))
                .Select(t => new AddOnTypeRule(t.Id, t.Name, t.IsRequired, t.MinSelect, t.MaxSelect))
                .ToListAsync(cancellationToken))
            .ToDictionary(r => r.Id);

        var addOnIds = addOns.Select(a => a.ProductId).ToList();
        var chosen = links.Where(l => addOnIds.Contains(l.AddOnId)).ToList();

        if (chosen.Count != addOnIds.Count)
        {
            throw new InvalidOperationException("One or more add-ons are not allowed for this product.");
        }

        var pickOneAddOns = chosen
            .Where(l => l.AddOnTypeId != null && rules.TryGetValue(l.AddOnTypeId.Value, out var r) && r.PickOne)
            .Select(l => l.AddOnId)
            .ToHashSet();

        if (addOns.Any(a => pickOneAddOns.Contains(a.ProductId) && a.Quantity != 1))
        {
            throw new InvalidOperationException("An add-on that allows only one choice can only be chosen once.");
        }

        foreach (var rule in rules.Values.OrderBy(r => r.Id))
        {
            var count = chosen.Count(l => l.AddOnTypeId == rule.Id);
            var message = AddOnSelectionRules.Check(rule, count);
            if (message is not null)
            {
                throw new InvalidOperationException(message);
            }
        }
    }
}
