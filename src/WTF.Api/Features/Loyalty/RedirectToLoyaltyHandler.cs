using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Loyalty.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Loyalty;

public record RedirectToLoyaltyQuery(string Token) : IRequest<RedirectToLoyaltyDto>;

public class RedirectToLoyaltyHandler(WTFDbContext db)
    : IRequestHandler<RedirectToLoyaltyQuery, RedirectToLoyaltyDto>
{
    public async Task<RedirectToLoyaltyDto> Handle(RedirectToLoyaltyQuery request,
        CancellationToken cancellationToken)
    {
        // Only loyalty links resolve here; a customer ordering token must never return a customer id.
        var link = await db.ShortLinks.FirstOrDefaultAsync(
            x => x.Token == request.Token && x.TargetType == "Loyalty", cancellationToken);

        if (link == null || (link.ExpiresAt.HasValue && link.ExpiresAt < DateTime.UtcNow))
        {
            return new RedirectToLoyaltyDto(null);
        }

        return new RedirectToLoyaltyDto(link.TargetId);
    }
}
