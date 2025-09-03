using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Contracts;
using WTF.Domain.Data;

namespace WTF.Api.Features.Loyalty.RedirectToLoyalty
{
    public class RedirectToLoyaltyHandler(WTFDbContext db) : IRequestHandler<RedirectToLoyaltyQuery, RedirectToLoyaltyDto>
    {
        private readonly WTFDbContext _db = db;

        public async Task<RedirectToLoyaltyDto> Handle(RedirectToLoyaltyQuery request, CancellationToken cancellationToken)
        {
            var link = await _db.ShortLinks.FirstOrDefaultAsync(x => x.Token == request.Token, cancellationToken);

            if (link == null || (link.ExpiresAt.HasValue && link.ExpiresAt < DateTime.UtcNow))
            {
                return new RedirectToLoyaltyDto(null);
            }

            return new RedirectToLoyaltyDto(link.TargetId);
        }
    }
}
