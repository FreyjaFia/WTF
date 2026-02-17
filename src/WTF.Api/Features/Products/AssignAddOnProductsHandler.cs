using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Contracts.Orders.Enums;
using WTF.Contracts.Products.Commands;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Products;

public class AssignAddOnProductsHandler(WTFDbContext db) : IRequestHandler<AssignAddOnProductsCommand, bool>
{
    public async Task<bool> Handle(AssignAddOnProductsCommand request, CancellationToken cancellationToken)
    {
        var addOn = await db.Products
            .FirstOrDefaultAsync(p => p.Id == request.AddOnId, cancellationToken);

        if (addOn == null)
        {
            return false;
        }

        if (!addOn.IsAddOn)
        {
            throw new InvalidOperationException("Cannot assign products to a product that is not an add-on.");
        }

        if (request.Products.Select(p => p.ProductId).Distinct().Count() != request.Products.Count)
        {
            throw new InvalidOperationException("Duplicate product IDs are not allowed.");
        }

        if (request.Products.Any(product => !Enum.IsDefined(product.AddOnType)))
        {
            throw new InvalidOperationException("One or more products have an invalid add-on type.");
        }

        var productIds = request.Products.Select(p => p.ProductId).ToList();

        // Validate all product IDs exist and are NOT add-ons
        var products = await db.Products
            .Where(p => productIds.Contains(p.Id))
            .ToListAsync(cancellationToken);

        if (products.Count != productIds.Count)
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
        var currentProductIds = await db.ProductAddOns
            .Where(pa => pa.AddOnId == request.AddOnId)
            .Select(pa => pa.ProductId)
            .ToListAsync(cancellationToken);

        var removedProductIds = currentProductIds.Except(productIds).ToList();

        // Update pending orders: decouple this add-on from removed parent products
        if (removedProductIds.Count != 0)
        {
            var pendingOrders = await db.Orders
                .Where(o => o.StatusId == (int)OrderStatusEnum.Pending)
                .Select(o => o.Id)
                .ToListAsync(cancellationToken);

            if (pendingOrders.Count != 0)
            {
                var affectedItems = await db.OrderItems
                    .Where(oi => pendingOrders.Contains(oi.OrderId)
                        && oi.ProductId == request.AddOnId
                        && oi.ParentOrderItem != null
                        && removedProductIds.Contains(oi.ParentOrderItem.ProductId))
                    .ToListAsync(cancellationToken);

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
        var existingLinks = await db.ProductAddOns
            .Where(pa => pa.AddOnId == request.AddOnId)
            .ToListAsync(cancellationToken);

        db.ProductAddOns.RemoveRange(existingLinks);

        // Assign new products with types
        var newLinks = request.Products.Select(product => new ProductAddOn
        {
            ProductId = product.ProductId,
            AddOnId = request.AddOnId,
            AddOnTypeId = (int)product.AddOnType
        });

        db.ProductAddOns.AddRange(newLinks);

        await db.SaveChangesAsync(cancellationToken);

        return true;
    }
}
