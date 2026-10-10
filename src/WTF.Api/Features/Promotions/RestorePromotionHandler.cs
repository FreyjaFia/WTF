using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Domain.Data;

namespace WTF.Api.Features.Promotions;

public record RestorePromotionCommand(Guid PromotionId) : IRequest<bool>;

public sealed class RestorePromotionHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<RestorePromotionCommand, bool>
{
    public async Task<bool> Handle(RestorePromotionCommand request, CancellationToken cancellationToken)
    {
        var promo = await db.Promotions
            .FirstOrDefaultAsync(x => x.Id == request.PromotionId, cancellationToken);

        if (promo is null)
        {
            return false;
        }

        promo.IsActive = true;
        promo.UpdatedAt = DateTime.UtcNow;
        promo.UpdatedBy = httpContextAccessor.HttpContext!.User.GetUserId();

        await db.SaveChangesAsync(cancellationToken);
        return true;
    }
}
