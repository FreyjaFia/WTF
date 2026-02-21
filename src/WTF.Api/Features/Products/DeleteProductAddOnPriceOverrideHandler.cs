using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Domain.Data;

namespace WTF.Api.Features.Products;

public record DeleteProductAddOnPriceOverrideCommand(Guid ProductId, Guid AddOnId) : IRequest<bool>;

public class DeleteProductAddOnPriceOverrideHandler(WTFDbContext db) : IRequestHandler<DeleteProductAddOnPriceOverrideCommand, bool>
{
    public async Task<bool> Handle(DeleteProductAddOnPriceOverrideCommand request, CancellationToken cancellationToken)
    {
        var existing = await db.ProductAddOnPriceOverrides
            .FirstOrDefaultAsync(o => o.ProductId == request.ProductId && o.AddOnId == request.AddOnId, cancellationToken);

        if (existing == null)
        {
            return false;
        }

        db.ProductAddOnPriceOverrides.Remove(existing);
        await db.SaveChangesAsync(cancellationToken);
        return true;
    }
}
