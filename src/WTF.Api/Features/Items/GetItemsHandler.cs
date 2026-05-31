using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Items.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Items;

public record GetItemsQuery(
    string? SearchTerm = null,
    bool? IsActive = null,
    bool IncludeInactive = false) : IRequest<List<ItemDto>>;

public class GetItemsHandler(WTFDbContext db) : IRequestHandler<GetItemsQuery, List<ItemDto>>
{
    public async Task<List<ItemDto>> Handle(GetItemsQuery request, CancellationToken cancellationToken)
    {
        var query = db.Items.AsNoTracking().AsQueryable();

        if (!request.IncludeInactive)
        {
            query = query.Where(i => i.IsActive);
        }

        if (request.IsActive.HasValue)
        {
            query = query.Where(i => i.IsActive == request.IsActive.Value);
        }

        if (!string.IsNullOrWhiteSpace(request.SearchTerm))
        {
            var search = request.SearchTerm.Trim();
            query = query.Where(i =>
                i.Name.Contains(search)
                || (i.Sku != null && i.Sku.Contains(search))
                || (i.Barcode != null && i.Barcode.Contains(search)));
        }

        var items = await query
            .Include(i => i.ProductItemLinks)
                .ThenInclude(l => l.Product)
            .OrderBy(i => i.Name)
            .ToListAsync(cancellationToken);

        return items.Select(ItemMapping.ToDto).ToList();
    }
}
