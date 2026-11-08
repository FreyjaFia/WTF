using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Tenancy;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Tenancy;

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

        if (request.Change == TenantStatusChange.Cancel && tenant.Id == TenantDefaults.DefaultTenantId)
        {
            throw new InvalidOperationException("The first shop cannot be cancelled.");
        }

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
        var changedAt = DateTime.UtcNow;

        // Only the request that still finds the old status changes it, so two at the same moment cannot both win or both be logged.
        var changed = await db.Tenants
            .Where(t => t.Id == tenant.Id && t.Status == old)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.Status, newStatus).SetProperty(t => t.UpdatedAt, changedAt), cancellationToken);
        statusCache.Forget(tenant.Id);
        if (changed == 0)
        {
            throw new InvalidOperationException("This shop was just changed by someone else. Reload and try again.");
        }

        tenant.Status = newStatus;
        tenant.UpdatedAt = changedAt;

        await audit.LogAsync(
            action,
            tenant.Id,
            $"{PlatformTenantNames.StatusName(old)} -> {PlatformTenantNames.StatusName(newStatus)}. {request.Reason}".Trim(),
            cancellationToken: cancellationToken);

        return new PlatformTenantDto(tenant.Id, tenant.Name, tenant.Slug, tenant.Status, PlatformTenantNames.StatusName(tenant.Status), tenant.CreatedAt, 0, 0, null);
    }
}
