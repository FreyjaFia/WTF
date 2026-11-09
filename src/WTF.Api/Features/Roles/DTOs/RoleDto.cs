namespace WTF.Api.Features.Roles.DTOs;

public record RoleDto(
    int Id,
    string Name,
    string? Description,
    bool IsSystem,
    int UserCount,
    int PermissionCount,
    DateTime? CreatedAt,
    List<string> Permissions);
