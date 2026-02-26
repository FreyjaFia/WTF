using System.Text.Json;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Services;

public sealed class AuditService(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor) : IAuditService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task LogAsync(
        AuditAction action,
        AuditEntityType entityType,
        string entityId,
        object? oldValues = null,
        object? newValues = null,
        Guid? userId = null,
        CancellationToken cancellationToken = default)
    {
        var resolvedUserId = userId ?? TryGetCurrentUserId();
        if (!resolvedUserId.HasValue)
        {
            return;
        }

        var ipAddress = httpContextAccessor.HttpContext?.Connection.RemoteIpAddress?.ToString();

        var log = new AuditLog
        {
            UserId = resolvedUserId.Value,
            Action = action.ToString(),
            EntityType = entityType.ToString(),
            EntityId = entityId,
            OldValues = oldValues is null ? null : JsonSerializer.Serialize(oldValues, JsonOptions),
            NewValues = newValues is null ? null : JsonSerializer.Serialize(newValues, JsonOptions),
            IpAddress = ipAddress,
            Timestamp = DateTime.UtcNow
        };

        db.AuditLogs.Add(log);
        await db.SaveChangesAsync(cancellationToken);
    }

    private Guid? TryGetCurrentUserId()
    {
        try
        {
            var principal = httpContextAccessor.HttpContext?.User;
            if (principal?.Identity?.IsAuthenticated != true)
            {
                return null;
            }

            return principal.GetUserId();
        }
        catch
        {
            return null;
        }
    }
}
