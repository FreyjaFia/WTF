using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Services;

public interface IPlatformAuditService
{
    Task LogAsync(
        string action,
        Guid? tenantId = null,
        string? details = null,
        Guid? platformAdminId = null,
        string? username = null,
        CancellationToken cancellationToken = default);
}

public sealed class PlatformAuditService(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IPlatformAuditService
{
    public async Task LogAsync(
        string action,
        Guid? tenantId = null,
        string? details = null,
        Guid? platformAdminId = null,
        string? username = null,
        CancellationToken cancellationToken = default)
    {
        var context = httpContextAccessor.HttpContext;
        var user = context?.User;

        if (platformAdminId is null && user is not null)
        {
            var id = user.FindFirst(ImpersonationByClaim)?.Value
                ?? user.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
                ?? user.FindFirst("sub")?.Value;
            platformAdminId = Guid.TryParse(id, out var parsed) ? parsed : null;
            username ??= user.FindFirst("impersonated_by_name")?.Value ?? user.Identity?.Name;
        }

        db.PlatformAuditLogs.Add(new PlatformAuditLog
        {
            PlatformAdminId = platformAdminId,
            Username = username,
            Action = action,
            TenantId = tenantId,
            Details = details is { Length: > 2000 } ? details[..2000] : details,
            IpAddress = context?.Connection.RemoteIpAddress?.ToString(),
            Timestamp = DateTime.UtcNow
        });

        await db.SaveChangesAsync(cancellationToken);
    }

    private const string ImpersonationByClaim = "impersonated_by";
}
