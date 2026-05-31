using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Items.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Items;

public record GetItemByIdQuery(Guid Id) : IRequest<ItemDto?>;

public class GetItemByIdHandler(WTFDbContext db) : IRequestHandler<GetItemByIdQuery, ItemDto?>
{
    public async Task<ItemDto?> Handle(GetItemByIdQuery request, CancellationToken cancellationToken)
    {
        var item = await db.Items
            .AsNoTracking()
            .Include(i => i.ProductItemLinks)
                .ThenInclude(l => l.Product)
            .Include(i => i.StockMovements.OrderByDescending(m => m.CreatedAt).Take(25))
                .ThenInclude(m => m.CreatedByNavigation)
            .FirstOrDefaultAsync(i => i.Id == request.Id, cancellationToken);

        return item is null ? null : ItemMapping.ToDto(item);
    }
}
