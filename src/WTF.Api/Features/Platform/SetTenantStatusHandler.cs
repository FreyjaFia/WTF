using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Tenancy;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Platform;

public enum TenantStatusChange
{
    Suspend = 1,
    Resume = 2,
    Cancel = 3
}

public record SetTenantStatusCommand(Guid TenantId, TenantStatusChange Change, string? Reason = null) : IRequest<PlatformTenantDto>;

public class SetTenantStatusHandler(WTFDbContext db, IPlatformAuditService audit, TenantStatusCache statusCache) : IRequestHandler<SetTenantStatusCommand, PlatformTenantDto>
{
    public async Task<PlatformTenantDto> Handle(SetTenantStatusCommand request, CancellationToken cancellationToken)
    {
        var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Id == request.TenantId, cancellationToken)
            ?? throw new KeyNotFoundException("Shop not found.");

        var (newStatus, action) = request.Change switch
        {
            TenantStatusChange.Suspend when tenant.Status is TenantAccess.Trial or TenantAccess.Active
                => (TenantAccess.Suspended, PlatformActions.TenantSuspended),
            TenantStatusChange.Resume when tenant.Status is TenantAccess.Suspended
                => (TenantAccess.Active, PlatformActions.TenantResumed),
            TenantStatusChange.Cancel when tenant.Status is not TenantAccess.Cancelled
                => (TenantAccess.Cancelled, PlatformActions.TenantCancelled),
            _ => throw new InvalidOperationException($"A {PlatformTenantNames.StatusName(tenant.Status).ToLowerInvariant()} shop cannot be {request.Change.ToString().ToLowerInvariant()}ed this way.")
        };

        var old = tenant.Status;
        tenant.Status = newStatus;
        tenant.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        statusCache.Forget(tenant.Id);

        await audit.LogAsync(
            action,
            tenant.Id,
            $"{PlatformTenantNames.StatusName(old)} -> {PlatformTenantNames.StatusName(newStatus)}. {request.Reason}".Trim(),
            cancellationToken: cancellationToken);

        return new PlatformTenantDto(tenant.Id, tenant.Name, tenant.Slug, tenant.Status, PlatformTenantNames.StatusName(tenant.Status), tenant.CreatedAt, 0, 0, null);
    }
}
