using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Tenancy;
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

public class GetOrdersHandler(WTFDbContext db, ITenantFeatures tenantFeatures, IHttpContextAccessor? httpContextAccessor = null) : IRequestHandler<GetOrdersQuery, List<OrderDto>>
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
            .Include(o => o.OrderSeniorPwdDiscounts)
            .AsNoTrackingWithIdentityResolution()
            .AsSplitQuery();

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

        var previewPrices = await PendingOrderPreview.LoadAsync(db, orders, httpContextAccessor, cancellationToken, tenantFeatures);

        return [.. orders.Select(o => OrderMapping.ToDto(
            o,
            OrderMapping.ToItemDtos(o.OrderItems.Where(oi => oi.ParentOrderItemId == null), overridePrices),
            OrderMetrics.ComputeOrderTotal(o, overridePrices, previewPrices),
            OrderMapping.ToBundleDtos(o),
            o.OrderSeniorPwdDiscounts,
            maskIds: true,
            includeCustomerName: true))];
    }
}
