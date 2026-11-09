namespace WTF.Api.Features.Roles.DTOs;

public record RoleDetailDto(
    int Id,
    string Name,
    string? Description,
    bool IsSystem,
    int UserCount,
    List<string> Permissions);
