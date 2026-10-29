using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Inventory.Waste.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory.Waste;

public record GetPosWasteItemsQuery : IRequest<List<PosWasteItemDto>>;

public class GetPosWasteItemsHandler(WTFDbContext db) : IRequestHandler<GetPosWasteItemsQuery, List<PosWasteItemDto>>
{
    public async Task<List<PosWasteItemDto>> Handle(GetPosWasteItemsQuery request, CancellationToken cancellationToken)
    {
        return await db.Items.AsNoTracking()
            .Where(i => i.IsActive)
            .OrderBy(i => i.Name)
            .Select(i => new PosWasteItemDto(
                i.Id,
                i.Name,
                i.UnitName,
                i.StockUnitName,
                i.UnitsPerStockUnit,
                i.CurrentQuantity,
                i.AllowNegativeStock,
                i.WasteApprovalLimit))
            .ToListAsync(cancellationToken);
    }
}
