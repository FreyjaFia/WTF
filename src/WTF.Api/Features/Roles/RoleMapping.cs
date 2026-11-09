using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Features.Roles.DTOs;

namespace WTF.Api.Features.Roles;

internal static class RoleMapping
{
    public static PermissionDto ToDto(PermissionDefinition definition) =>
        new(definition.Key, definition.Area, definition.Label, definition.Description, definition.Feature, [.. definition.Requires]);
}
