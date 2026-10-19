using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Items.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory;

public record GetItemMovementsQuery(Guid ItemId, string? Type = null, int Page = 1, int PageSize = 25)
    : IRequest<PagedStockMovementsDto?>;

public class GetItemMovementsHandler(WTFDbContext db) : IRequestHandler<GetItemMovementsQuery, PagedStockMovementsDto?>
{
    private const int MaxPageSize = 100;

    public async Task<PagedStockMovementsDto?> Handle(GetItemMovementsQuery request, CancellationToken cancellationToken)
    {
        if (!await db.Items.AnyAsync(i => i.Id == request.ItemId, cancellationToken))
        {
            return null;
        }

        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, MaxPageSize);
        var query = db.StockMovements.AsNoTracking().Where(m => m.ItemId == request.ItemId);
        if (!string.IsNullOrWhiteSpace(request.Type))
        {
            query = query.Where(m => m.MovementType == request.Type);
        }

        var total = await query.CountAsync(cancellationToken);
        var movements = await query
            .Include(m => m.CreatedByNavigation)
            .OrderByDescending(m => m.CreatedAt)
            .ThenByDescending(m => m.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        var lookups = await StockMovementMapping.LoadLookupsAsync(db, movements, cancellationToken);
        return new PagedStockMovementsDto(movements.Select(m => StockMovementMapping.ToDto(m, lookups)).ToList(), total);
    }
}
