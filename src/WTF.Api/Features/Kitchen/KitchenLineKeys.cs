using WTF.Api.Features.Orders.DTOs;
using WTF.Calculations.Kitchen;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Kitchen;

// Turns order lines into the keys the board compares. Prices, discounts and line ids are left out on purpose, so a price
// change or a discount that splits a line never raises a CHANGED tag.
internal static class KitchenLineKeys
{
    private sealed record AddOnPart(Guid ProductId, string Name, int Quantity, string? Note);

    public static List<KitchenLine> FromOrderItems(IEnumerable<OrderItem> items)
    {
        var all = items.ToList();
        return
        [
            .. all.Where(i => i.ParentOrderItemId == null).Select(parent => Build(
                parent.ProductId,
                parent.Product.Name,
                parent.Quantity,
                parent.SpecialInstructions,
                all.Where(c => c.ParentOrderItemId == parent.Id)
                    .Select(c => new AddOnPart(c.ProductId, c.Product.Name, c.Quantity, c.SpecialInstructions))))
        ];
    }

    public static List<KitchenLine> FromRequest(IEnumerable<OrderItemRequestDto> items, IReadOnlyDictionary<Guid, string> names) =>
    [
        .. items.Select(item => Build(
            item.ProductId,
            names.GetValueOrDefault(item.ProductId, "Item"),
            item.Quantity,
            item.SpecialInstructions,
            item.AddOns.Select(a => new AddOnPart(a.ProductId, names.GetValueOrDefault(a.ProductId, "Add-on"), a.Quantity, a.SpecialInstructions))))
    ];

    private static KitchenLine Build(Guid productId, string name, int quantity, string? note, IEnumerable<AddOnPart> addOns)
    {
        var parts = addOns.OrderBy(a => a.ProductId).ToList();
        var key = $"{productId}|{string.Join(",", parts.Select(a => $"{a.ProductId}x{a.Quantity}:{Normalize(a.Note)}"))}|{Normalize(note)}";
        var label = parts.Count == 0
            ? name
            : $"{name} ({string.Join(", ", parts.Select(a => a.Quantity > 1 ? $"{a.Name} x{a.Quantity}" : a.Name))})";
        return new KitchenLine(key, label, quantity);
    }

    private static string Normalize(string? note) => (note ?? string.Empty).Trim().ToLowerInvariant();
}
