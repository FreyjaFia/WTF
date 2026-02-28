using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Products;

public record DeleteProductCommand(Guid Id) : IRequest<bool>;

public class DeleteProductHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor, IAuditService auditService) : IRequestHandler<DeleteProductCommand, bool>
{
    public async Task<bool> Handle(DeleteProductCommand request, CancellationToken cancellationToken)
    {
        var product = await db.Products
            .FirstOrDefaultAsync(p => p.Id == request.Id, cancellationToken);

        if (product == null)
        {
            return false;
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var oldValues = new
        {
            product.Name,
            product.Code,
            product.IsActive
        };

        // Soft delete - set IsActive to false
        product.IsActive = false;
        product.UpdatedAt = DateTime.UtcNow;
        product.UpdatedBy = userId;

        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            action: AuditAction.ProductDeleted,
            entityType: AuditEntityType.Product,
            entityId: product.Id.ToString(),
            oldValues: oldValues,
            newValues: new
            {
                product.IsActive
            },
            userId: userId,
            cancellationToken: cancellationToken);

        return true;
    }
}
