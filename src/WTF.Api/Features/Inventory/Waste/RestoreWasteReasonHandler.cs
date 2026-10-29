using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory.Waste.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory.Waste;

public record RestoreWasteReasonCommand(int Id) : IRequest<WasteReasonDto?>;

public class RestoreWasteReasonHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<RestoreWasteReasonCommand, WasteReasonDto?>
{
    public async Task<WasteReasonDto?> Handle(RestoreWasteReasonCommand request, CancellationToken cancellationToken)
    {
        var reason = await db.WasteReasons.FirstOrDefaultAsync(r => r.Id == request.Id, cancellationToken);
        if (reason is null)
        {
            return null;
        }

        if (reason.IsActive)
        {
            return WasteReasonRules.ToDto(reason);
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        reason.IsActive = true;
        reason.UpdatedAt = DateTime.UtcNow;
        reason.UpdatedBy = userId;
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            AuditAction.WasteReasonRestored,
            AuditEntityType.WasteReason,
            reason.Id.ToString(),
            oldValues: new { IsActive = false },
            newValues: new { reason.Name, IsActive = true },
            userId: userId,
            cancellationToken: cancellationToken);

        return WasteReasonRules.ToDto(reason);
    }
}
