using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory.Waste.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory.Waste;

public record UpdateWasteReasonCommand(int Id, string? Name, bool RequiresNote, int SortOrder) : IRequest<WasteReasonDto?>;

public class UpdateWasteReasonHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<UpdateWasteReasonCommand, WasteReasonDto?>
{
    public async Task<WasteReasonDto?> Handle(UpdateWasteReasonCommand request, CancellationToken cancellationToken)
    {
        var reason = await db.WasteReasons.FirstOrDefaultAsync(r => r.Id == request.Id, cancellationToken);
        if (reason is null)
        {
            return null;
        }

        if (reason.IsSystem && reason.RequiresNote && !request.RequiresNote)
        {
            throw new InvalidOperationException($"\"{reason.Name}\" is a built-in reason and always needs a note.");
        }

        var name = await WasteReasonRules.ValidateNameAsync(db, request.Name, reason.Id, cancellationToken);
        var oldValues = new { reason.Name, reason.RequiresNote, reason.SortOrder };
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        reason.Name = name;
        reason.RequiresNote = request.RequiresNote;
        reason.SortOrder = request.SortOrder;
        reason.UpdatedAt = DateTime.UtcNow;
        reason.UpdatedBy = userId;
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            AuditAction.WasteReasonUpdated,
            AuditEntityType.WasteReason,
            reason.Id.ToString(),
            oldValues: oldValues,
            newValues: new { reason.Name, reason.RequiresNote, reason.SortOrder },
            userId: userId,
            cancellationToken: cancellationToken);

        return WasteReasonRules.ToDto(reason);
    }
}
