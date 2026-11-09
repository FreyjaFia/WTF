using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Roles.DTOs;
using WTF.Calculations.Subscriptions;
using WTF.Domain.Data;
using WTF.Domain.Tenancy;

namespace WTF.Api.Features.Roles;

public record GetPermissionCatalogQuery : IRequest<List<PermissionDto>>;

public class GetPermissionCatalogHandler(WTFDbContext db, ICurrentTenant tenant, ITenantFeatures tenantFeatures)
    : IRequestHandler<GetPermissionCatalogQuery, List<PermissionDto>>
{
    public async Task<List<PermissionDto>> Handle(GetPermissionCatalogQuery request, CancellationToken cancellationToken)
    {
        var features = tenant.TenantId is { } tenantId
            ? (await tenantFeatures.GetAsync(db, tenantId, cancellationToken)).Features
            : PlanFeatures.All();

        var plans = await db.Plans
            .AsNoTracking()
            .Where(p => p.IsActive)
            .OrderBy(p => p.SortOrder)
            .Select(p => new { p.Name, p.Features })
            .ToListAsync(cancellationToken);

        var availableIn = PermissionCatalog.All
            .Select(p => p.Feature)
            .Distinct()
            .ToDictionary(f => f, f => plans.Where(p => PlanFeatures.Parse(p.Features).Contains(f)).Select(p => p.Name).ToList());

        return [.. PermissionCatalog.All.Select(p => RoleMapping.ToDto(p) with
        {
            InPlan = PlanFeatures.IsAllowed(p.Feature, features),
            AvailableInPlans = availableIn[p.Feature]
        })];
    }
}
