using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Contracts.Orders.Enums;
using WTF.Contracts.Products.Commands;
using WTF.Domain.Data;

namespace WTF.Api.Features.Products;

public class AssignProductAddOnsHandler(WTFDbContext db) : IRequestHandler<AssignProductAddOnsCommand, bool>
{
    public async Task<bool> Handle(AssignProductAddOnsCommand request, CancellationToken cancellationToken)
    {
        var product = await db.Products
            .Include(p => p.AddOns)
            .FirstOrDefaultAsync(p => p.Id == request.ProductId, cancellationToken);

        if (product == null)
        {
            return false;
        }

        if (product.IsAddOn)
        {
            throw new InvalidOperationException("Cannot assign add-ons to a product that is itself an add-on.");
        }

        // Validate all add-on IDs exist and are marked as add-ons
        var addOns = await db.Products
            .Where(p => request.AddOnIds.Contains(p.Id))
            .ToListAsync(cancellationToken);

        if (addOns.Count != request.AddOnIds.Count)
        {
            throw new InvalidOperationException("One or more add-on IDs are invalid.");
        }

        var nonAddOns = addOns.Where(p => !p.IsAddOn).ToList();
        if (nonAddOns.Count != 0)
        {
            throw new InvalidOperationException(
                $"The following products are not marked as add-ons: {string.Join(", ", nonAddOns.Select(p => p.Name))}");
        }

        // Identify add-ons being removed
        var currentAddOnIds = product.AddOns.Select(a => a.Id).ToList();
        var removedAddOnIds = currentAddOnIds.Except(request.AddOnIds).ToList();

        // Update pending orders: decouple removed add-ons from this parent product
        if (removedAddOnIds.Any())
        {
            var pendingOrders = await db.Orders
                .Where(o => o.StatusId == (int)OrderStatusEnum.Pending)
                .Select(o => o.Id)
                .ToListAsync(cancellationToken);

            if (pendingOrders.Any())
            {
                // Find order items that are:
                // 1. In pending orders
                // 2. Are the removed add-ons
                // 3. Linked to this parent product
                var affectedItems = await db.OrderItems
                    .Where(oi => pendingOrders.Contains(oi.OrderId)
                        && removedAddOnIds.Contains(oi.ProductId)
                        && oi.ParentOrderItem != null
                        && oi.ParentOrderItem.ProductId == request.ProductId)
                    .ToListAsync(cancellationToken);

                // Decouple them: make them standalone items
                foreach (var item in affectedItems)
                {
                    item.ParentOrderItemId = null;
                }

                if (affectedItems.Any())
                {
                    await db.SaveChangesAsync(cancellationToken);
                }
            }
        }

        // Clear existing add-ons
        product.AddOns.Clear();

        // Assign new add-ons
        foreach (var addOn in addOns)
        {
            product.AddOns.Add(addOn);
        }

        await db.SaveChangesAsync(cancellationToken);

        return true;
    }
}
