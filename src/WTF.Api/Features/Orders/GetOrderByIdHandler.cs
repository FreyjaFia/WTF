using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Orders;
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
            .Include(o => o.Customer)
            .Include(o => o.OrderItems.Where(oi => oi.ParentOrderItemId == null))
                .ThenInclude(oi => oi.Product)
            .Include(o => o.OrderItems.Where(oi => oi.ParentOrderItemId == null))
                .ThenInclude(oi => oi.InverseParentOrderItem)
                    .ThenInclude(child => child.Product)
            .Include(o => o.OrderBundlePromotions)
                .ThenInclude(obp => obp.Promotion)
            .FirstOrDefaultAsync(o => o.Id == request.Id, cancellationToken);

        if (order is null)
        {
            return null;
        }

        // Build a lookup of override prices so pending orders show the correct effective price
        var parentItems = order.OrderItems
            .Where(oi => oi.ParentOrderItemId == null)
            .OrderBy(oi => oi.SortOrder)
            .ThenBy(oi => oi.Id)
            .ToList();
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
                    .OrderBy(child => child.SortOrder)
                    .ThenBy(child => child.Id)
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
                            child.SpecialInstructions,
                            child.BundlePromotionId
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
                    oi.SpecialInstructions,
                    oi.BundlePromotionId
                );
            })
            .ToList();

        var bundlePromotions = order.OrderBundlePromotions
            .Select(obp => new OrderBundlePromotionDto(
                obp.PromotionId,
                obp.Promotion.Name,
                obp.Quantity,
                obp.UnitPrice))
            .ToList();

        var totalAmount = OrderMetrics.ComputeOrderTotal(order, overridePrices);

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
            order.Note,
            totalAmount,
            order.Customer == null ? null : $"{order.Customer.FirstName} {order.Customer.LastName}".Trim(),
            bundlePromotions
        );
    }
}
