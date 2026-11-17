using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Calculations.Orders;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

public record GetOrderByIdQuery(Guid Id) : IRequest<OrderDto?>;

public class GetOrderByIdHandler(WTFDbContext db, ITenantFeatures tenantFeatures, IHttpContextAccessor? httpContextAccessor = null) : IRequestHandler<GetOrderByIdQuery, OrderDto?>
{
    public async Task<OrderDto?> Handle(GetOrderByIdQuery request, CancellationToken cancellationToken)
    {
        var order = await db.Orders
            .Include(o => o.Customer)
            .Include(o => o.Branch)
            .Include(o => o.OrderItems.Where(oi => oi.ParentOrderItemId == null))
                .ThenInclude(oi => oi.Product)
            .Include(o => o.OrderItems.Where(oi => oi.ParentOrderItemId == null))
                .ThenInclude(oi => oi.InverseParentOrderItem)
                    .ThenInclude(child => child.Product)
            .Include(o => o.OrderBundlePromotions)
                .ThenInclude(obp => obp.Promotion)
            .Include(o => o.OrderSeniorPwdDiscounts)
            .AsNoTrackingWithIdentityResolution()
            .AsSplitQuery()
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
        var previewPrices = await PendingOrderPreview.LoadAsync(db, [order], httpContextAccessor, cancellationToken, tenantFeatures);

        var items = OrderMapping.ToItemDtos(parentItems, overridePrices);
        var totalAmount = OrderMetrics.ComputeOrderTotal(order, overridePrices, previewPrices);
        var stockLineIds = await LoadStockLineIdsAsync(order, parentItems, cancellationToken);

        return OrderMapping.ToDto(
            order,
            items,
            totalAmount,
            OrderMapping.ToBundleDtos(order),
            order.OrderSeniorPwdDiscounts,
            maskIds: !SeniorPwdMapping.CanSeeFullId(httpContextAccessor),
            includeCustomerName: true,
            stockLineIds: stockLineIds,
            reviewDetails: await OrderReviewReasons.LoadAsync(db, order.Id, cancellationToken));
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
