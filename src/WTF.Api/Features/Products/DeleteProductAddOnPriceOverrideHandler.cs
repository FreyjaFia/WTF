using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Domain.Data;

namespace WTF.Api.Features.Products;

public record DeleteProductAddOnPriceOverrideCommand(Guid ProductId, Guid AddOnId) : IRequest<bool>;

public class DeleteProductAddOnPriceOverrideHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<DeleteProductAddOnPriceOverrideCommand, bool>
{
    public async Task<bool> Handle(DeleteProductAddOnPriceOverrideCommand request, CancellationToken cancellationToken)
    {
        var existing = await db.ProductAddOnPriceOverrides
            .FirstOrDefaultAsync(o => o.ProductId == request.ProductId && o.AddOnId == request.AddOnId, cancellationToken);

        if (existing == null)
        {
            return false;
        }

        // Soft delete - keep the row so the price can be restored by creating the override again
        if (existing.IsActive)
        {
            var userId = httpContextAccessor.HttpContext!.User.GetUserId();
            existing.IsActive = false;
            existing.UpdatedAt = DateTime.UtcNow;
            existing.UpdatedBy = userId;
            await db.SaveChangesAsync(cancellationToken);
        }

        return true;
    }
}
