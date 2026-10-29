using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Inventory.Waste.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory.Waste;

public record GetPendingWasteCountQuery : IRequest<PendingWasteCountDto>;

public class GetPendingWasteCountHandler(WTFDbContext db) : IRequestHandler<GetPendingWasteCountQuery, PendingWasteCountDto>
{
    public async Task<PendingWasteCountDto> Handle(GetPendingWasteCountQuery request, CancellationToken cancellationToken)
    {
        var count = await db.StockWastes.AsNoTracking()
            .CountAsync(w => w.Status == StockWasteStatuses.PendingReview, cancellationToken);

        return new PendingWasteCountDto(count);
    }
}
