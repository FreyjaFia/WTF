namespace WTF.Api.Features.Platform;

public record PlatformTenantDto(
    Guid Id,
    string Name,
    string Slug,
    byte Status,
    string StatusName,
    DateTime CreatedAt,
    int UserCount,
    int OrderCount,
    DateTime? LastOrderAt,
    string? PlanName = null,
    DateTime? PeriodEnd = null,
    string? Warning = null);

public record PlatformTenantUserDto(Guid Id, string Username, string FirstName, string LastName, string Role, bool IsActive);

public record CreatedTenantDto(PlatformTenantDto Tenant, string OwnerUsername, string TemporaryPassword);

public record PasswordResetDto(string Username, string TemporaryPassword);

public record ImpersonationDto(string AccessToken, DateTime ExpiresAt, string Username, string TenantName, bool ReadOnly);

public record PlatformAuditLogDto(Guid Id, string? Username, string Action, Guid? TenantId, string? Details, string? IpAddress, DateTime Timestamp);

public record DeletionPreviewDto(Guid TenantId, string Slug, byte Status, Dictionary<string, int> RowCounts);

public static class PlatformTenantNames
{
    public static string StatusName(byte status) => status switch
    {
        1 => "Trial",
        2 => "Active",
        3 => "Suspended",
        4 => "Cancelled",
        _ => "Unknown"
    };
}
