using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Inventory.Waste.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory.Waste;

public record GetWasteReasonsQuery(bool IncludeInactive = false) : IRequest<List<WasteReasonDto>>;

public class GetWasteReasonsHandler(WTFDbContext db) : IRequestHandler<GetWasteReasonsQuery, List<WasteReasonDto>>
{
    public async Task<List<WasteReasonDto>> Handle(GetWasteReasonsQuery request, CancellationToken cancellationToken)
    {
        var query = db.WasteReasons.AsNoTracking();
        if (!request.IncludeInactive)
        {
            query = query.Where(r => r.IsActive);
        }

        return await query
            .OrderBy(r => r.SortOrder)
            .ThenBy(r => r.Name)
            .Select(r => new WasteReasonDto(r.Id, r.Name, r.RequiresNote, r.SortOrder, r.IsActive, r.IsSystem))
            .ToListAsync(cancellationToken);
    }
}
