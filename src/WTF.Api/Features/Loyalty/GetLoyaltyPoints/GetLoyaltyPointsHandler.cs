using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Contracts;
using WTF.Domain.Data;

namespace WTF.Api.Features.Loyalty.GetLoyaltyPoints
{
    public class GetLoyaltyPointsHandler(WTFDbContext db) : IRequestHandler<GetLoyaltyPointsQuery, LoyaltyPointsDto?>
    {
        private readonly WTFDbContext _db = db;

        public async Task<LoyaltyPointsDto?> Handle(GetLoyaltyPointsQuery request, CancellationToken cancellationToken)
        {
            var entity = await _db.LoyaltyPoints
                .Include(x => x.Customer)
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.CustomerId == request.CustomerId, cancellationToken);

            if (entity is null)
            {
                return null;
            }

            return new LoyaltyPointsDto(request.CustomerId, entity.Points, entity.Customer.FirstName, entity.Customer.LastName);
        }
    }
}
