using MediatR;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Features.Roles.DTOs;

namespace WTF.Api.Features.Roles;

public record GetPermissionCatalogQuery : IRequest<List<PermissionDto>>;

public class GetPermissionCatalogHandler : IRequestHandler<GetPermissionCatalogQuery, List<PermissionDto>>
{
    public Task<List<PermissionDto>> Handle(GetPermissionCatalogQuery request, CancellationToken cancellationToken) =>
        Task.FromResult(PermissionCatalog.All.Select(RoleMapping.ToDto).ToList());
}
