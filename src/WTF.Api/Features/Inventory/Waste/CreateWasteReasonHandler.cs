using MediatR;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory.Waste.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory.Waste;

public record WasteReasonRequest(string? Name, bool RequiresNote, int SortOrder);

public record CreateWasteReasonCommand(string? Name, bool RequiresNote, int SortOrder) : IRequest<WasteReasonDto>;

public class CreateWasteReasonHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<CreateWasteReasonCommand, WasteReasonDto>
{
    public async Task<WasteReasonDto> Handle(CreateWasteReasonCommand request, CancellationToken cancellationToken)
    {
        var name = await WasteReasonRules.ValidateNameAsync(db, request.Name, null, cancellationToken);
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        var reason = new WasteReason
        {
            Name = name,
            RequiresNote = request.RequiresNote,
            SortOrder = request.SortOrder,
            IsActive = true,
            IsSystem = false,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId
        };

        db.WasteReasons.Add(reason);
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            AuditAction.WasteReasonCreated,
            AuditEntityType.WasteReason,
            reason.Id.ToString(),
            newValues: new { reason.Name, reason.RequiresNote, reason.SortOrder },
            userId: userId,
            cancellationToken: cancellationToken);

        return WasteReasonRules.ToDto(reason);
    }
}
