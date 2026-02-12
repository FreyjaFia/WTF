using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Contracts.Loyalty;
using WTF.Contracts.Loyalty.Queries;
using WTF.Domain.Data;

namespace WTF.Api.Features.Loyalty;

public class RedirectToLoyaltyHandler(WTFDbContext db)
    : IRequestHandler<RedirectToLoyaltyQuery, RedirectToLoyaltyDto>
{
    public async Task<RedirectToLoyaltyDto> Handle(RedirectToLoyaltyQuery request,
        CancellationToken cancellationToken)
    {
        var link = await db.ShortLinks.FirstOrDefaultAsync(x => x.Token == request.Token, cancellationToken);

        if (link == null || (link.ExpiresAt.HasValue && link.ExpiresAt < DateTime.UtcNow))
        {
            return new RedirectToLoyaltyDto(null);
        }

        return new RedirectToLoyaltyDto(link.TargetId);
    }
}