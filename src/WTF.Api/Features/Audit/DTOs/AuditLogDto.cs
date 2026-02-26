namespace WTF.Api.Features.Audit.DTOs;

public sealed record AuditLogDto(
    Guid Id,
    Guid UserId,
    string? UserName,
    string Action,
    string EntityType,
    string EntityId,
    string? OldValues,
    string? NewValues,
    string? IpAddress,
    DateTime Timestamp
);
