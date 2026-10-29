using MediatR;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory.Waste.DTOs;
using WTF.Api.Features.Notifications;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory.Waste;

public record DisputeWasteCommand(Guid Id, string? Note) : IRequest<StockWasteDto?>;

public class DisputeWasteHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    INotificationService? notifications = null) : IRequestHandler<DisputeWasteCommand, StockWasteDto?>
{
    public Task<StockWasteDto?> Handle(DisputeWasteCommand request, CancellationToken cancellationToken) =>
        WasteReview.ReviewAsync(
            db,
            httpContextAccessor,
            auditService,
            notifications,
            request.Id,
            request.Note,
            noteRequired: true,
            StockWasteStatuses.Disputed,
            AuditAction.StockWasteDisputed,
            cancellationToken);
}
