using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Contracts.OrderItems;
using WTF.Contracts.Orders;
using WTF.Contracts.Orders.Commands;
using WTF.Contracts.Orders.Enums;
using WTF.Contracts.Products.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Orders;

public class CreateOrderHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<CreateOrderCommand, OrderDto>
{
    public async Task<OrderDto> Handle(CreateOrderCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        // Validate no nested add-ons and add-on type rules
        foreach (var item in request.Items)
        {
            if (item.AddOns.Any(addOn => addOn.AddOns?.Count > 0))
            {
                throw new InvalidOperationException("Nested add-ons are not allowed. Add-ons cannot have their own add-ons.");
            }

            var addOnIds = item.AddOns.Select(addOn => addOn.ProductId).ToList();

            var availableTypes = await db.ProductAddOns
                .Where(pa => pa.ProductId == item.ProductId)
                .Select(pa => (AddOnTypeEnum)(pa.AddOnTypeId ?? (int)AddOnTypeEnum.Extra))
                .Distinct()
                .ToListAsync(cancellationToken);

            if (addOnIds.Count == 0)
            {
                if (availableTypes.Contains(AddOnTypeEnum.Size))
                {
                    throw new InvalidOperationException("A size selection is required and must be exactly one.");
                }

                continue;
            }

            var productAddOns = await db.ProductAddOns
                .Where(pa => pa.ProductId == item.ProductId && addOnIds.Contains(pa.AddOnId))
                .Select(pa => new
                {
                    pa.AddOnId,
                    AddOnType = (AddOnTypeEnum)(pa.AddOnTypeId ?? (int)AddOnTypeEnum.Extra)
                })
                .ToListAsync(cancellationToken);

            if (productAddOns.Count != addOnIds.Count)
            {
                throw new InvalidOperationException("One or more add-ons are not allowed for this product.");
            }

            var selectedByType = productAddOns
                .GroupBy(pa => pa.AddOnType)
                .ToDictionary(group => group.Key, group => group.Count());

            if (availableTypes.Contains(AddOnTypeEnum.Size))
            {
                var sizeCount = selectedByType.TryGetValue(AddOnTypeEnum.Size, out var count)
                    ? count
                    : 0;

                if (sizeCount != 1)
                {
                    throw new InvalidOperationException("A size selection is required and must be exactly one.");
                }
            }

            if (selectedByType.TryGetValue(AddOnTypeEnum.Flavor, out var flavorCount) && flavorCount > 1)
            {
                throw new InvalidOperationException("Only one flavor can be selected.");
            }
        }

        var order = new Order
        {
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId,
            CustomerId = request.CustomerId,
            SpecialInstructions = request.SpecialInstructions,
            StatusId = (int)request.Status,
            PaymentMethodId = request.PaymentMethod.HasValue ? (int)request.PaymentMethod.Value : null,
            AmountReceived = request.AmountReceived,
            ChangeAmount = request.ChangeAmount,
            Tips = request.Tips
        };

        db.Orders.Add(order);
        await db.SaveChangesAsync(cancellationToken);

        // Add order items with parent-child relationships
        foreach (var item in request.Items)
        {
            var product = await db.Products.FindAsync([item.ProductId], cancellationToken) ?? throw new InvalidOperationException($"Product with ID {item.ProductId} not found.");
            var orderItem = new OrderItem
            {
                OrderId = order.Id,
                ProductId = item.ProductId,
                Quantity = item.Quantity,
                SpecialInstructions = item.SpecialInstructions,
                Price = null,
                ParentOrderItemId = null
            };

            // Capture price if order is Completed or Cancelled
            if (request.Status == OrderStatusEnum.Completed || request.Status == OrderStatusEnum.Cancelled)
            {
                orderItem.Price = product.Price;
            }

            db.OrderItems.Add(orderItem);
            await db.SaveChangesAsync(cancellationToken);

            // Add child items (add-ons)
            foreach (var addOn in item.AddOns)
            {
                var addOnProduct = await db.Products.FindAsync([addOn.ProductId], cancellationToken) ?? throw new InvalidOperationException($"Add-on product with ID {addOn.ProductId} not found.");
                var addOnOverridePrice = await db.ProductAddOnPriceOverrides
                    .Where(o => o.ProductId == item.ProductId && o.AddOnId == addOn.ProductId && o.IsActive)
                    .Select(o => (decimal?)o.Price)
                    .FirstOrDefaultAsync(cancellationToken);
                var effectiveAddOnPrice = addOnOverridePrice ?? addOnProduct.Price;

                var addOnOrderItem = new OrderItem
                {
                    OrderId = order.Id,
                    ProductId = addOn.ProductId,
                    Quantity = addOn.Quantity,
                    SpecialInstructions = addOn.SpecialInstructions,
                    Price = null,
                    ParentOrderItemId = orderItem.Id
                };

                // Capture price if order is Completed or Cancelled
                if (request.Status == OrderStatusEnum.Completed || request.Status == OrderStatusEnum.Cancelled)
                {
                    addOnOrderItem.Price = effectiveAddOnPrice;
                }

                db.OrderItems.Add(addOnOrderItem);
            }
        }

        await db.SaveChangesAsync(cancellationToken);

        // Get items with hierarchy
        var items = await db.OrderItems
            .Where(oi => oi.OrderId == order.Id && oi.ParentOrderItemId == null)
            .Include(oi => oi.Product)
            .Include(oi => oi.InverseParentOrderItem)
                .ThenInclude(child => child.Product)
            .Select(oi => new OrderItemDto(
                oi.Id,
                oi.ProductId,
                oi.Product.Name,
                oi.Quantity,
                oi.Price,
                oi.InverseParentOrderItem.Select(child => new OrderItemDto(
                    child.Id,
                    child.ProductId,
                    child.Product.Name,
                    child.Quantity,
                    child.Price,
                    new List<OrderItemDto>(),
                    child.SpecialInstructions
                )).ToList(),
                oi.SpecialInstructions
            ))
            .ToListAsync(cancellationToken);

        var totalAmount = await db.OrderItems
            .Where(oi => oi.OrderId == order.Id)
            .Include(oi => oi.Product)
            .SumAsync(oi => (oi.Price ?? oi.Product.Price) * oi.Quantity, cancellationToken);

        return new OrderDto(
            order.Id,
            order.OrderNumber,
            order.CreatedAt,
            order.CreatedBy,
            order.UpdatedAt,
            order.UpdatedBy,
            items,
            order.CustomerId,
            (OrderStatusEnum)order.StatusId,
            order.PaymentMethodId.HasValue ? (PaymentMethodEnum)order.PaymentMethodId.Value : null,
            order.AmountReceived,
            order.ChangeAmount,
            order.Tips,
            order.SpecialInstructions,
            totalAmount
        );
    }
}
