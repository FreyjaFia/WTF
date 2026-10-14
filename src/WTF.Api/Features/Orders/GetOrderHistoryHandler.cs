using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Calculations.Orders;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

public record GetOrderHistoryQuery(Guid? CustomerId = null) : IRequest<List<OrderHistoryDto>>;

public class GetOrderHistoryHandler(WTFDbContext db) : IRequestHandler<GetOrderHistoryQuery, List<OrderHistoryDto>>
{
    public async Task<List<OrderHistoryDto>> Handle(GetOrderHistoryQuery request, CancellationToken cancellationToken)
    {
        var historyStatuses = new[] { (int)OrderStatusEnum.Completed, (int)OrderStatusEnum.Refunded };

        var query = db.Orders
            .AsNoTracking()
            .Include(o => o.Customer)
            // Load every line (parents and add-ons) with its product: OrderMetrics.ComputeOrderTotal reads add-ons
            // from Order.OrderItems, and a filtered include of parents only would leave them out of the total.
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .Include(o => o.OrderBundlePromotions)
            .Where(o => historyStatuses.Contains(o.StatusId))
            .AsQueryable();

        if (request.CustomerId.HasValue)
        {
            query = query.Where(o => o.CustomerId == request.CustomerId.Value);
        }

        var orders = await query
            .OrderByDescending(o => o.CreatedAt)
            .ToListAsync(cancellationToken);

        var overridePrices = await AddOnPriceLookup.ForOrdersAsync(db, orders, cancellationToken);

        return [.. orders.Select(o =>
        {
            var totalAmount = OrderMetrics.ComputeOrderTotal(o, overridePrices);

            return new OrderHistoryDto(
                o.Id,
                o.OrderNumber,
                o.CreatedAt,
                o.CreatedBy,
                o.UpdatedAt,
                o.UpdatedBy,
                o.CustomerId,
                (OrderStatusEnum)o.StatusId,
                o.PaymentMethodId.HasValue ? (PaymentMethodEnum)o.PaymentMethodId.Value : null,
                o.AmountReceived,
                o.ChangeAmount,
                o.Tips,
                o.SpecialInstructions,
                o.Note,
                totalAmount,
                o.Customer == null ? null : $"{o.Customer.FirstName} {o.Customer.LastName}".Trim()
            );
        })];
    }
}
