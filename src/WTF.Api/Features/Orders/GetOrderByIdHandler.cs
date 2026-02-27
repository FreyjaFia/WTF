using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

public record GetOrderByIdQuery(Guid Id) : IRequest<OrderDto?>;

public class GetOrderByIdHandler(WTFDbContext db) : IRequestHandler<GetOrderByIdQuery, OrderDto?>
{
    public async Task<OrderDto?> Handle(GetOrderByIdQuery request, CancellationToken cancellationToken)
    {
        var order = await db.Orders
            .Include(o => o.OrderItems.Where(oi => oi.ParentOrderItemId == null))
                .ThenInclude(oi => oi.Product)
            .Include(o => o.OrderItems.Where(oi => oi.ParentOrderItemId == null))
                .ThenInclude(oi => oi.InverseParentOrderItem)
                    .ThenInclude(child => child.Product)
            .FirstOrDefaultAsync(o => o.Id == request.Id, cancellationToken);

        if (order is null)
        {
            return null;
        }

        // Build a lookup of override prices so pending orders show the correct effective price
        var parentItems = order.OrderItems.Where(oi => oi.ParentOrderItemId == null).ToList();
        var parentProductIds = parentItems.Select(oi => oi.ProductId).Distinct().ToList();
        var addOnProductIds = parentItems
            .SelectMany(oi => oi.InverseParentOrderItem)
            .Select(child => child.ProductId)
            .Distinct()
            .ToList();

        var overridePrices = new Dictionary<(Guid ProductId, Guid AddOnId), decimal>();

        if (addOnProductIds.Count > 0)
        {
            overridePrices = await db.ProductAddOnPriceOverrides
                .Where(o => parentProductIds.Contains(o.ProductId) && addOnProductIds.Contains(o.AddOnId) && o.IsActive)
                .ToDictionaryAsync(o => (o.ProductId, o.AddOnId), o => o.Price, cancellationToken);
        }

        var items = parentItems
            .Select(oi =>
            {
                var addOns = oi.InverseParentOrderItem
                    .Select(child =>
                    {
                        var childEffectivePrice = child.Price
                            ?? (overridePrices.TryGetValue((oi.ProductId, child.ProductId), out var op) ? op : child.Product.Price);

                        return new OrderItemDto(
                            child.Id,
                            child.ProductId,
                            child.Product.Name,
                            child.Quantity,
                            childEffectivePrice,
                            [],
                            child.SpecialInstructions
                        );
                    })
                    .ToList();

                return new OrderItemDto(
                    oi.Id,
                    oi.ProductId,
                    oi.Product.Name,
                    oi.Quantity,
                    oi.Price ?? oi.Product.Price,
                    addOns,
                    oi.SpecialInstructions
                );
            })
            .ToList();

        var totalAmount = items
            .Sum(item =>
            {
                var addOnUnitTotal = item.AddOns.Sum(ao => (ao.Price ?? 0) * ao.Quantity);
                return ((item.Price ?? 0) + addOnUnitTotal) * item.Quantity;
            });

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
