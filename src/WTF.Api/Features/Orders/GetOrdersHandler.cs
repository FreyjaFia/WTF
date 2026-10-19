using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Calculations.Orders;
using WTF.Calculations.Sales;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

public record GetOrdersQuery(
    OrderStatusEnum Status = OrderStatusEnum.All,
    Guid? CustomerId = null,
    bool ExcludeFinalized = false) : IRequest<List<OrderDto>>;

public class GetOrdersHandler(WTFDbContext db, IHttpContextAccessor? httpContextAccessor = null) : IRequestHandler<GetOrdersQuery, List<OrderDto>>
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
            .Include(o => o.OrderBundlePromotions)
                .ThenInclude(obp => obp.Promotion)
            .AsQueryable();

        if (request.CustomerId.HasValue)
        {
            query = query.Where(o => o.CustomerId == request.CustomerId.Value);
        }

        if (request.Status != OrderStatusEnum.All)
        {
            query = query.Where(o => o.StatusId == (int)request.Status);
        }
        else
        {
            // Orders waiting for staff (approval or review) are not part of the normal list: they only come back when asked for.
            query = query.Where(o => !OrderStatuses.Unconfirmed.Contains(o.StatusId));

            if (request.ExcludeFinalized)
            {
                query = query.Where(o => o.StatusId != (int)OrderStatusEnum.Completed && o.StatusId != (int)OrderStatusEnum.Refunded);
            }
        }

        var orders = await query
            .OrderByDescending(o => o.CreatedAt)
            .ToListAsync(cancellationToken);

        // Build a lookup of override prices so pending orders show the correct effective price
        var overridePrices = await AddOnPriceLookup.ForParentItemsAsync(
            db,
            orders.SelectMany(o => o.OrderItems.Where(oi => oi.ParentOrderItemId == null)),
            cancellationToken);

        var previewPrices = await PendingOrderPreview.LoadAsync(db, orders, httpContextAccessor, cancellationToken);

        return [.. orders.Select(o =>
        {
            var items = o.OrderItems
                .Where(oi => oi.ParentOrderItemId == null)
                .OrderBy(oi => oi.SortOrder)
                .ThenBy(oi => oi.Id)
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

            var bundlePromotions = o.OrderBundlePromotions
                .Select(obp => new OrderBundlePromotionDto(
                    obp.PromotionId,
                    obp.Promotion.Name,
                    obp.Quantity,
                    obp.UnitPrice))
                .ToList();

            var totalAmount = OrderMetrics.ComputeOrderTotal(o, overridePrices, previewPrices);

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
                o.Note,
                totalAmount,
                o.Customer == null ? null : $"{o.Customer.FirstName} {o.Customer.LastName}".Trim(),
                bundlePromotions,
                o.OverrideReason,
                o.OverriddenAt,
                (OrderSourceEnum)o.Source,
                o.FulfillmentType.HasValue ? (FulfillmentTypeEnum)o.FulfillmentType.Value : null,
                o.DeliveryAddress,
                o.ContactNumber,
                o.RejectionReason,
                o.AcceptedAt,
                o.ReadyAt,
                o.ReviewReasons,
                o.QuotedTotal,
                o.OfflineLocalId
            );
        })];
    }
}
