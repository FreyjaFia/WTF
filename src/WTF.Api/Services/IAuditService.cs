using WTF.Api.Features.Audit.Enums;

namespace WTF.Api.Services;

public interface IAuditService
{
    Task LogAsync(
        AuditAction action,
        AuditEntityType entityType,
        string entityId,
        object? oldValues = null,
        object? newValues = null,
        Guid? userId = null,
        CancellationToken cancellationToken = default);
}
