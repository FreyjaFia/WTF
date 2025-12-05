using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Contracts.OrderItems;
using WTF.Contracts.Orders;
using WTF.Contracts.Orders.Commands;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Orders;

public class CreateOrderHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<CreateOrderCommand, OrderDto>
{
    public async Task<OrderDto> Handle(CreateOrderCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var status = await db.Statuses.FirstOrDefaultAsync(s => s.Id == request.Status, cancellationToken);

        if (status is null)
        {
            throw new Exception("Invalid status");
        }

        var order = new Order
        {
            OrderNumber = Guid.NewGuid().ToString()[..8],
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId,
            CustomerId = request.CustomerId,
            StatusId = status.Id
        };

        db.Orders.Add(order);
        await db.SaveChangesAsync(cancellationToken);

        // Add order items
        foreach (var item in request.Items)
        {
            db.OrderItems.Add(new OrderItem
            {
                OrderId = order.Id,
                ProductId = item.ProductId,
                Quantity = item.Quantity
            });
        }
        await db.SaveChangesAsync(cancellationToken);

        var items = await db.OrderItems
            .Where(oi => oi.OrderId == order.Id)
            .Select(oi => new OrderItemDto(oi.Id, oi.ProductId, oi.Quantity))
            .ToListAsync(cancellationToken);

        return new OrderDto(
            order.Id,
            order.OrderNumber,
            order.CreatedAt,
            order.CreatedBy,
            order.UpdatedAt,
            order.UpdatedBy,
            items,
            order.CustomerId,
            status.Id
        );
    }
}
