namespace WTF.Api.Common.Auth.Permissions;

public record PermissionDefinition(
    string Key,
    string Area,
    string Label,
    string Description,
    string Feature,
    string[] Requires);
