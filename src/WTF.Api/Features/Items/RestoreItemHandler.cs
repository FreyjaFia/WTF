using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Items;

public record RestoreItemCommand(Guid Id) : IRequest<bool>;

public class RestoreItemHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    IStockAlertService stockAlerts) : IRequestHandler<RestoreItemCommand, bool>
{
    public async Task<bool> Handle(RestoreItemCommand request, CancellationToken cancellationToken)
    {
        var item = await db.Items.FirstOrDefaultAsync(i => i.Id == request.Id, cancellationToken);
        if (item is null)
        {
            return false;
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var oldValues = new
        {
            item.Name,
            item.Sku,
            item.Barcode,
            item.IsActive
        };

        item.IsActive = true;
        item.UpdatedAt = DateTime.UtcNow;
        item.UpdatedBy = userId;

        await db.SaveChangesAsync(cancellationToken);

        // An item restored while low is told to the people who look after it, like any other drop to that level.
        await stockAlerts.EvaluateAsync([item.Id], cancellationToken);

        await auditService.LogAsync(
            AuditAction.ItemRestored,
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
