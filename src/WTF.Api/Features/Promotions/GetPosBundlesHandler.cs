using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Orders;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Promotions;

public sealed record PosBundlesDto(
    List<FixedBundlePromotionDto> FixedBundles,
    List<MixMatchPromotionDto> MixMatch);

public record GetPosBundlesQuery : IRequest<PosBundlesDto>;

// Every active bundle with its items, for whoever sells at the POS. The management endpoints are for Admins only, so a
// Cashier could not load a bundle through them. Dates, weekdays and hours are left for the POS to judge (it keeps this
// list for offline use); the server checks them again when an order is saved.
public sealed class GetPosBundlesHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<GetPosBundlesQuery, PosBundlesDto>
{
    public async Task<PosBundlesDto> Handle(GetPosBundlesQuery request, CancellationToken cancellationToken)
    {
        var promotions = await db.Promotions
            .AsNoTracking()
            .Where(p => p.IsActive && (p.TypeId == PromotionTypeIds.FixedBundle || p.TypeId == PromotionTypeIds.MixMatch))
            .Include(p => p.FixedBundlePromotion!)
                .ThenInclude(f => f.FixedBundlePromotionItems)
                    .ThenInclude(i => i.FixedBundlePromotionItemAddOns)
            .Include(p => p.MixMatchPromotion!)
                .ThenInclude(m => m.MixMatchPromotionProducts)
                    .ThenInclude(i => i.MixMatchPromotionProductAddOns)
            .Include(p => p.PromotionImage!)
                .ThenInclude(i => i.Image)
            .OrderBy(p => p.Name)
            .ToListAsync(cancellationToken);

        var used = await PromotionUsage.CountAsync(db, [.. promotions.Select(p => p.Id)], null, cancellationToken);

        return new PosBundlesDto(
            [.. promotions
                .Where(p => p.FixedBundlePromotion is not null)
                .Select(p => FixedBundleMapping.ToDto(p, httpContextAccessor, used[p.Id]))],
            [.. promotions
                .Where(p => p.MixMatchPromotion is not null)
                .Select(p => MixMatchMapping.ToDto(p, httpContextAccessor, used[p.Id]))]);
    }
}
