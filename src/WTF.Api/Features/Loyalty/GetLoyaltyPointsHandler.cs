using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Loyalty.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Loyalty;

public record GetLoyaltyPointsQuery(Guid CustomerId) : IRequest<GetLoyaltyPointsDto>;

public class GetLoyaltyPointsHandler(WTFDbContext db)
    : IRequestHandler<GetLoyaltyPointsQuery, GetLoyaltyPointsDto?>
{
    public async Task<GetLoyaltyPointsDto?> Handle(GetLoyaltyPointsQuery request,
        CancellationToken cancellationToken)
    {
        var entity = await db.LoyaltyPoints
            .Include(x => x.Customer)
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.CustomerId == request.CustomerId, cancellationToken);

        if (entity is null)
        {
            return null;
        }

        return new GetLoyaltyPointsDto(request.CustomerId, entity.Points, entity.Customer.FirstName,
            entity.Customer.LastName);
    }
}