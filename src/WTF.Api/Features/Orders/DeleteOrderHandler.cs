using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Contracts.Orders.Commands;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

public class DeleteOrderHandler(WTFDbContext db) : IRequestHandler<DeleteOrderCommand, bool>
{
    public async Task<bool> Handle(DeleteOrderCommand request, CancellationToken cancellationToken)
    {
        var order = await db.Orders.Include(o => o.OrderItems)
            .FirstOrDefaultAsync(o => o.Id == request.Id, cancellationToken);

        if (order is null)
        {
            return false;
        }

        db.OrderItems.RemoveRange(order.OrderItems);
        db.Orders.Remove(order);

        await db.SaveChangesAsync(cancellationToken);

        return true;
    }
}
