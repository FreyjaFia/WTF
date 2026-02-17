using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Contracts.Orders.Enums;
using WTF.Contracts.Products.Commands;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Products;

public class AssignProductAddOnsHandler(WTFDbContext db) : IRequestHandler<AssignProductAddOnsCommand, bool>
{
    public async Task<bool> Handle(AssignProductAddOnsCommand request, CancellationToken cancellationToken)
    {
        var product = await db.Products
            .FirstOrDefaultAsync(p => p.Id == request.ProductId, cancellationToken);

        if (product == null)
        {
            return false;
        }

        if (product.IsAddOn)
        {
            throw new InvalidOperationException("Cannot assign add-ons to a product that is itself an add-on.");
        }

        if (request.AddOns.Select(a => a.AddOnId).Distinct().Count() != request.AddOns.Count)
        {
            throw new InvalidOperationException("Duplicate add-on IDs are not allowed.");
        }

        if (request.AddOns.Any(addOn => !Enum.IsDefined(addOn.AddOnType)))
        {
            throw new InvalidOperationException("One or more add-ons have an invalid type.");
        }

        var addOnIds = request.AddOns.Select(a => a.AddOnId).ToList();

        // Validate all add-on IDs exist and are marked as add-ons
        var addOns = await db.Products
            .Where(p => addOnIds.Contains(p.Id))
            .ToListAsync(cancellationToken);

        if (addOns.Count != addOnIds.Count)
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
        var currentAddOnIds = await db.ProductAddOns
            .Where(pa => pa.ProductId == request.ProductId)
            .Select(pa => pa.AddOnId)
            .ToListAsync(cancellationToken);

        var removedAddOnIds = currentAddOnIds.Except(addOnIds).ToList();

        // Update pending orders: decouple removed add-ons from this parent product
        if (removedAddOnIds.Count != 0)
        {
            var pendingOrders = await db.Orders
                .Where(o => o.StatusId == (int)OrderStatusEnum.Pending)
                .Select(o => o.Id)
                .ToListAsync(cancellationToken);

            if (pendingOrders.Count != 0)
            {
                var affectedItems = await db.OrderItems
                    .Where(oi => pendingOrders.Contains(oi.OrderId)
                        && removedAddOnIds.Contains(oi.ProductId)
                        && oi.ParentOrderItem != null
                        && oi.ParentOrderItem.ProductId == request.ProductId)
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

        // Clear existing add-ons
        var existingLinks = await db.ProductAddOns
            .Where(pa => pa.ProductId == request.ProductId)
            .ToListAsync(cancellationToken);

        db.ProductAddOns.RemoveRange(existingLinks);

        // Assign new add-ons with types
        var newLinks = request.AddOns.Select(addOn => new ProductAddOn
        {
            ProductId = request.ProductId,
            AddOnId = addOn.AddOnId,
            AddOnTypeId = (int)addOn.AddOnType
        });

        db.ProductAddOns.AddRange(newLinks);

        await db.SaveChangesAsync(cancellationToken);

        return true;
    }
}
