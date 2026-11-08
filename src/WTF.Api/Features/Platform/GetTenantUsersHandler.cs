using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Domain.Data;

namespace WTF.Api.Features.Platform;

public record GetTenantUsersQuery(Guid TenantId) : IRequest<List<PlatformTenantUserDto>>;

public class GetTenantUsersHandler(WTFDbContext db) : IRequestHandler<GetTenantUsersQuery, List<PlatformTenantUserDto>>
{
    public async Task<List<PlatformTenantUserDto>> Handle(GetTenantUsersQuery request, CancellationToken cancellationToken)
    {
        if (!await db.Tenants.AnyAsync(t => t.Id == request.TenantId, cancellationToken))
        {
            throw new KeyNotFoundException("Shop not found.");
        }

        return await db.Users.IgnoreQueryFilters().AsNoTracking()
            .Where(u => u.TenantId == request.TenantId && !u.Username.StartsWith("customer-link"))
            .OrderBy(u => u.Username)
            .Select(u => new PlatformTenantUserDto(u.Id, u.Username, u.FirstName, u.LastName, u.Role.Name, u.IsActive))
            .ToListAsync(cancellationToken);
    }
}
