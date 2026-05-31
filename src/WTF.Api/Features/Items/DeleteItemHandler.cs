using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Items;

public record DeleteItemCommand(Guid Id) : IRequest<bool>;

public class DeleteItemHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<DeleteItemCommand, bool>
{
    public async Task<bool> Handle(DeleteItemCommand request, CancellationToken cancellationToken)
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

        item.IsActive = false;
        item.UpdatedAt = DateTime.UtcNow;
        item.UpdatedBy = userId;

        await db.SaveChangesAsync(cancellationToken);

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
