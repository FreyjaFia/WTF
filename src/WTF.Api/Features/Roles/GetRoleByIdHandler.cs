using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Roles.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Roles;

public record GetRoleByIdQuery(int Id) : IRequest<RoleDetailDto?>;

public class GetRoleByIdHandler(WTFDbContext db) : IRequestHandler<GetRoleByIdQuery, RoleDetailDto?>
{
    public async Task<RoleDetailDto?> Handle(GetRoleByIdQuery request, CancellationToken cancellationToken)
    {
        var role = await db.UserRoles.AsNoTracking().FirstOrDefaultAsync(r => r.Id == request.Id, cancellationToken);
        if (role is null)
        {
            return null;
        }

        var keys = await RoleRules.KeysOfAsync(db, role, cancellationToken);
        var userCount = await db.Users.CountAsync(u => u.RoleId == role.Id, cancellationToken);

        return new RoleDetailDto(role.Id, role.Name, role.Description, role.TenantId is null, userCount, [.. keys.Order()]);
    }
}
