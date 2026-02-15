using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Contracts.Orders.Enums;
using WTF.Contracts.Products.Commands;
using WTF.Domain.Data;

namespace WTF.Api.Features.Products;

public class AssignAddOnProductsHandler(WTFDbContext db) : IRequestHandler<AssignAddOnProductsCommand, bool>
{
    public async Task<bool> Handle(AssignAddOnProductsCommand request, CancellationToken cancellationToken)
    {
        var addOn = await db.Products
            .Include(p => p.Products)
            .FirstOrDefaultAsync(p => p.Id == request.AddOnId, cancellationToken);

        if (addOn == null)
        {
            return false;
        }

        if (!addOn.IsAddOn)
        {
            throw new InvalidOperationException("Cannot assign products to a product that is not an add-on.");
        }

        // Validate all product IDs exist and are NOT add-ons
        var products = await db.Products
            .Where(p => request.ProductIds.Contains(p.Id))
            .ToListAsync(cancellationToken);

        if (products.Count != request.ProductIds.Count)
        {
            throw new InvalidOperationException("One or more product IDs are invalid.");
        }

        var addOnProducts = products.Where(p => p.IsAddOn).ToList();
        if (addOnProducts.Count != 0)
        {
            throw new InvalidOperationException(
                $"The following products are add-ons and cannot be assigned: {string.Join(", ", addOnProducts.Select(p => p.Name))}");
        }

        // Identify products being removed from this add-on
        var currentProductIds = addOn.Products.Select(p => p.Id).ToList();
        var removedProductIds = currentProductIds.Except(request.ProductIds).ToList();

        // Update pending orders: decouple this add-on from removed parent products
        if (removedProductIds.Count != 0)
        {
            var pendingOrders = await db.Orders
                .Where(o => o.StatusId == (int)OrderStatusEnum.Pending)
                .Select(o => o.Id)
                .ToListAsync(cancellationToken);

            if (pendingOrders.Count != 0)
            {
                // Find order items that are:
                // 1. In pending orders
                // 2. Are this add-on
                // 3. Linked to one of the removed parent products
                var affectedItems = await db.OrderItems
                    .Where(oi => pendingOrders.Contains(oi.OrderId)
                        && oi.ProductId == request.AddOnId
                        && oi.ParentOrderItem != null
                        && removedProductIds.Contains(oi.ParentOrderItem.ProductId))
                    .ToListAsync(cancellationToken);

                // Decouple them: make them standalone items
                foreach (var item in affectedItems)
                {
                    item.ParentOrderItemId = null;
                }

                if (affectedItems.Count != 0)
                {
                    await db.SaveChangesAsync(cancellationToken);
                }
            }
        }

        // Clear existing product associations
        addOn.Products.Clear();

        // Assign new products
        foreach (var product in products)
        {
            addOn.Products.Add(product);
        }

        await db.SaveChangesAsync(cancellationToken);

        return true;
    }
}
