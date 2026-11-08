using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Domain.Data;

namespace WTF.Api.Features.Platform;

public record GetPlatformTenantsQuery : IRequest<List<PlatformTenantDto>>;

public class GetPlatformTenantsHandler(WTFDbContext db) : IRequestHandler<GetPlatformTenantsQuery, List<PlatformTenantDto>>
{
    public async Task<List<PlatformTenantDto>> Handle(GetPlatformTenantsQuery request, CancellationToken cancellationToken)
    {
        var tenants = await db.Tenants.AsNoTracking().OrderBy(t => t.Name).ToListAsync(cancellationToken);

        var users = await db.Users.IgnoreQueryFilters().AsNoTracking()
            .GroupBy(u => u.TenantId)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count, cancellationToken);

        var orders = await db.Orders.IgnoreQueryFilters().AsNoTracking()
            .GroupBy(o => o.TenantId)
            .Select(g => new { g.Key, Count = g.Count(), Last = g.Max(o => (DateTime?)o.CreatedAt) })
            .ToDictionaryAsync(x => x.Key, x => x, cancellationToken);

        return [.. tenants.Select(t => new PlatformTenantDto(
            t.Id,
            t.Name,
            t.Slug,
            t.Status,
            PlatformTenantNames.StatusName(t.Status),
            t.CreatedAt,
            users.GetValueOrDefault(t.Id),
            orders.TryGetValue(t.Id, out var o) ? o.Count : 0,
            orders.TryGetValue(t.Id, out var o2) ? o2.Last : null))];
    }
}
