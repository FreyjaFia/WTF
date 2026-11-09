namespace WTF.Api.Features.Roles.DTOs;

public record PermissionDto(
    string Key,
    string Area,
    string Label,
    string Description,
    string Feature,
    List<string> Requires,
    bool InPlan = true,
    List<string>? AvailableInPlans = null);
