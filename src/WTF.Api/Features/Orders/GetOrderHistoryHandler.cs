using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
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
            .Include(o => o.OrderItems.Where(oi => oi.ParentOrderItemId == null))
                .ThenInclude(oi => oi.InverseParentOrderItem)
            .Where(o => historyStatuses.Contains(o.StatusId))
            .AsQueryable();

        if (request.CustomerId.HasValue)
        {
            query = query.Where(o => o.CustomerId == request.CustomerId.Value);
        }

        var orders = await query
            .OrderByDescending(o => o.CreatedAt)
            .ToListAsync(cancellationToken);

        return [.. orders.Select(o =>
        {
            var totalAmount = o.OrderItems
                .Where(oi => oi.ParentOrderItemId == null)
                .Sum(parent =>
                {
                    var parentUnitPrice = parent.Price ?? 0m;
                    var addOnPerUnit = parent.InverseParentOrderItem.Sum(child => (child.Price ?? 0m) * child.Quantity);
                    return (parentUnitPrice + addOnPerUnit) * parent.Quantity;
                });

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
