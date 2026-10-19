using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Inventory.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory;

public record GetOrderStockMovementsQuery(Guid OrderId) : IRequest<List<OrderStockMovementDto>?>;

public class GetOrderStockMovementsHandler(WTFDbContext db)
    : IRequestHandler<GetOrderStockMovementsQuery, List<OrderStockMovementDto>?>
{
    public async Task<List<OrderStockMovementDto>?> Handle(GetOrderStockMovementsQuery request, CancellationToken cancellationToken)
    {
        if (!await db.Orders.AnyAsync(o => o.Id == request.OrderId, cancellationToken))
        {
            return null;
        }

        return await db.StockMovements
            .AsNoTracking()
            .Where(m => m.ReferenceType == StockMovementTypes.OrderReference && m.ReferenceId == request.OrderId)
            .OrderBy(m => m.CreatedAt)
            .ThenBy(m => m.QuantityBefore)
            .Select(m => new OrderStockMovementDto(
                m.Id,
                m.ItemId,
                m.Item.Name,
                m.Item.UnitName,
                m.ProductId,
                m.Product != null ? m.Product.Name : null,
                m.MovementType,
                m.QuantityDelta,
                m.QuantityBefore,
                m.QuantityAfter,
                m.Notes,
                m.CreatedAt))
            .ToListAsync(cancellationToken);
    }
}
