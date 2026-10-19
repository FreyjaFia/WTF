using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Orders;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Calculations.Orders;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

public record GetOrderByIdQuery(Guid Id) : IRequest<OrderDto?>;

public class GetOrderByIdHandler(WTFDbContext db, IHttpContextAccessor? httpContextAccessor = null) : IRequestHandler<GetOrderByIdQuery, OrderDto?>
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
        var overridePrices = await AddOnPriceLookup.ForParentItemsAsync(db, parentItems, cancellationToken);
        var previewPrices = await PendingOrderPreview.LoadAsync(db, [order], httpContextAccessor, cancellationToken);

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
                    oi.BundlePromotionId,
                    oi.OriginalPrice,
                    oi.PromoLabel,
                oi.DiscountPromotionId
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

        var totalAmount = OrderMetrics.ComputeOrderTotal(order, overridePrices, previewPrices);

        var stockLineIds = await LoadStockLineIdsAsync(order, parentItems, cancellationToken);

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
            bundlePromotions,
            order.OverrideReason,
            order.OverriddenAt,
            (OrderSourceEnum)order.Source,
            order.FulfillmentType.HasValue ? (FulfillmentTypeEnum)order.FulfillmentType.Value : null,
            order.DeliveryAddress,
            order.ContactNumber,
            order.RejectionReason,
            order.AcceptedAt,
            order.ReadyAt,
            order.ReviewReasons,
            order.QuotedTotal,
            order.OfflineLocalId,
            StockLineIds: stockLineIds
        );
    }

    // The lines whose product (or one of its add-ons) took stock when the sale completed, so a refund only asks about those.
    private async Task<List<Guid>> LoadStockLineIdsAsync(
        WTF.Domain.Entities.Order order,
        List<WTF.Domain.Entities.OrderItem> parentItems,
        CancellationToken cancellationToken)
    {
        if (order.StatusId != (int)OrderStatusEnum.Completed)
        {
            return [];
        }

        var productIds = await db.StockMovements
            .AsNoTracking()
            .Where(m => m.ReferenceType == StockMovementTypes.OrderReference
                        && m.ReferenceId == order.Id
                        && m.ProductId != null
                        && m.MovementType == StockMovementTypes.Sale)
            .Select(m => m.ProductId!.Value)
            .Distinct()
            .ToListAsync(cancellationToken);

        return parentItems
            .Where(oi => productIds.Contains(oi.ProductId)
                         || oi.InverseParentOrderItem.Any(child => productIds.Contains(child.ProductId)))
            .Select(oi => oi.Id)
            .ToList();
    }
}
