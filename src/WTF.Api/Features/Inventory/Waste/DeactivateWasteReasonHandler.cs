using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory.Waste.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory.Waste;

public record DeactivateWasteReasonCommand(int Id) : IRequest<WasteReasonDto?>;

public class DeactivateWasteReasonHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<DeactivateWasteReasonCommand, WasteReasonDto?>
{
    public async Task<WasteReasonDto?> Handle(DeactivateWasteReasonCommand request, CancellationToken cancellationToken)
    {
        var reason = await db.WasteReasons.FirstOrDefaultAsync(r => r.Id == request.Id, cancellationToken);
        if (reason is null)
        {
            return null;
        }

        if (reason.IsSystem)
        {
            throw new InvalidOperationException($"\"{reason.Name}\" is a built-in reason and cannot be deactivated.");
        }

        if (!reason.IsActive)
        {
            return WasteReasonRules.ToDto(reason);
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        reason.IsActive = false;
        reason.UpdatedAt = DateTime.UtcNow;
        reason.UpdatedBy = userId;
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            AuditAction.WasteReasonDeactivated,
            AuditEntityType.WasteReason,
            reason.Id.ToString(),
            oldValues: new { IsActive = true },
            newValues: new { reason.Name, IsActive = false },
            userId: userId,
            cancellationToken: cancellationToken);

        return WasteReasonRules.ToDto(reason);
    }
}
