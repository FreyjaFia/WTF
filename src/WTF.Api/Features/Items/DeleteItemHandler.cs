using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Items;

public record DeleteItemCommand(Guid Id) : IRequest<bool>;

public class DeleteItemHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    IStockAlertService stockAlerts) : IRequestHandler<DeleteItemCommand, bool>
{
    public async Task<bool> Handle(DeleteItemCommand request, CancellationToken cancellationToken)
    {
        var item = await db.Items.FirstOrDefaultAsync(i => i.Id == request.Id, cancellationToken);
        if (item is null)
        {
            return false;
        }

        if (item.IsActive)
        {
            await ItemDeactivation.EnsureNoActiveProductLinksAsync(db, item.Id, cancellationToken);
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var oldValues = new
        {
            item.Name,
            item.Sku,
            item.Barcode,
            item.IsActive
        };

        item.IsActive = false;
        ItemDeactivation.ForgetAlertState(item);
        item.UpdatedAt = DateTime.UtcNow;
        item.UpdatedBy = userId;

        await db.SaveChangesAsync(cancellationToken);

        // The stock screens drop the item at once instead of waiting for the next refresh.
        await stockAlerts.EvaluateAsync([item.Id], cancellationToken);

        await auditService.LogAsync(
            AuditAction.ItemDeleted,
            AuditEntityType.Item,
            item.Id.ToString(),
            oldValues: oldValues,
            newValues: new
            {
                item.IsActive
            },
            userId: userId,
            cancellationToken: cancellationToken);

        return true;
    }
}
