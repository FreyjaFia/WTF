using Microsoft.EntityFrameworkCore;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Common.Orders;

/// <summary>
/// Loads the active add-on price overrides an order total needs (<see cref="WTF.Calculations.Orders.OrderMetrics"/> takes the
/// result). The one place that query lives, so every screen prices add-ons the same way.
/// </summary>
public static class AddOnPriceLookup
{
    /// <summary>For orders whose <c>OrderItems</c> hold every line, parents and add-ons alike.</summary>
    public static Task<Dictionary<(Guid ProductId, Guid AddOnId), decimal>> ForOrdersAsync(
        WTFDbContext db,
        IEnumerable<Order> orders,
        CancellationToken cancellationToken)
    {
        var lines = orders.SelectMany(o => o.OrderItems).ToList();
        return LoadAsync(
            db,
            lines.Where(oi => oi.ParentOrderItemId == null).Select(oi => oi.ProductId),
            lines.Where(oi => oi.ParentOrderItemId != null).Select(oi => oi.ProductId),
            cancellationToken);
    }

    /// <summary>For parent lines that have their add-ons loaded through <c>InverseParentOrderItem</c>.</summary>
    public static Task<Dictionary<(Guid ProductId, Guid AddOnId), decimal>> ForParentItemsAsync(
        WTFDbContext db,
        IEnumerable<OrderItem> parentItems,
        CancellationToken cancellationToken)
    {
        var parents = parentItems.ToList();
        return LoadAsync(
            db,
            parents.Select(oi => oi.ProductId),
            parents.SelectMany(oi => oi.InverseParentOrderItem).Select(child => child.ProductId),
            cancellationToken);
    }

    private static async Task<Dictionary<(Guid ProductId, Guid AddOnId), decimal>> LoadAsync(
        WTFDbContext db,
        IEnumerable<Guid> parentProductIds,
        IEnumerable<Guid> addOnProductIds,
        CancellationToken cancellationToken)
    {
        var parentIds = parentProductIds.Distinct().ToList();
        var addOnIds = addOnProductIds.Distinct().ToList();
        if (addOnIds.Count == 0)
        {
            return [];
        }

        return await db.ProductAddOnPriceOverrides
            .Where(o => o.IsActive && parentIds.Contains(o.ProductId) && addOnIds.Contains(o.AddOnId))
            .ToDictionaryAsync(o => (o.ProductId, o.AddOnId), o => o.Price, cancellationToken);
    }
}
