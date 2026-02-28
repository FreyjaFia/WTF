using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

public record GetOrdersQuery(
    OrderStatusEnum Status = OrderStatusEnum.All,
    Guid? CustomerId = null) : IRequest<List<OrderDto>>;

public class GetOrdersHandler(WTFDbContext db) : IRequestHandler<GetOrdersQuery, List<OrderDto>>
{
    public async Task<List<OrderDto>> Handle(GetOrdersQuery request, CancellationToken cancellationToken)
    {
        var query = db.Orders
            .Include(o => o.Customer)
            .Include(o => o.OrderItems.Where(oi => oi.ParentOrderItemId == null))
                .ThenInclude(oi => oi.Product)
            .Include(o => o.OrderItems.Where(oi => oi.ParentOrderItemId == null))
                .ThenInclude(oi => oi.InverseParentOrderItem)
                    .ThenInclude(child => child.Product)
            .AsQueryable();

        if (request.CustomerId.HasValue)
        {
            query = query.Where(o => o.CustomerId == request.CustomerId.Value);
        }

        if (request.Status != OrderStatusEnum.All)
        {
            query = query.Where(o => o.StatusId == (int)request.Status);
        }

        var orders = await query
            .OrderByDescending(o => o.CreatedAt)
            .ToListAsync(cancellationToken);

        // Build a lookup of override prices so pending orders show the correct effective price
        var allParentProductIds = orders
            .SelectMany(o => o.OrderItems.Where(oi => oi.ParentOrderItemId == null))
            .Select(oi => oi.ProductId)
            .Distinct()
            .ToList();

        var allAddOnProductIds = orders
            .SelectMany(o => o.OrderItems.Where(oi => oi.ParentOrderItemId == null))
            .SelectMany(oi => oi.InverseParentOrderItem)
            .Select(child => child.ProductId)
            .Distinct()
            .ToList();

        var overridePrices = new Dictionary<(Guid ProductId, Guid AddOnId), decimal>();

        if (allAddOnProductIds.Count > 0)
        {
            overridePrices = await db.ProductAddOnPriceOverrides
                .Where(o => allParentProductIds.Contains(o.ProductId) && allAddOnProductIds.Contains(o.AddOnId) && o.IsActive)
                .ToDictionaryAsync(o => (o.ProductId, o.AddOnId), o => o.Price, cancellationToken);
        }

        return [.. orders.Select(o =>
        {
            var items = o.OrderItems
                .Where(oi => oi.ParentOrderItemId == null)
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
                o.Id,
                o.OrderNumber,
                o.CreatedAt,
                o.CreatedBy,
                o.UpdatedAt,
                o.UpdatedBy,
                items,
                o.CustomerId,
                (OrderStatusEnum)o.StatusId,
                o.PaymentMethodId.HasValue ? (PaymentMethodEnum)o.PaymentMethodId.Value : null,
                o.AmountReceived,
                o.ChangeAmount,
                o.Tips,
                o.SpecialInstructions,
                totalAmount,
                o.Customer == null ? null : $"{o.Customer.FirstName} {o.Customer.LastName}".Trim()
            );
        })];
    }
}
