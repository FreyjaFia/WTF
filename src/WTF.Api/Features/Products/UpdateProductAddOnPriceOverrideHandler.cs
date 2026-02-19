using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Contracts.Products;
using WTF.Contracts.Products.Commands;
using WTF.Domain.Data;

namespace WTF.Api.Features.Products;

public class UpdateProductAddOnPriceOverrideHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<UpdateProductAddOnPriceOverrideCommand, ProductAddOnPriceOverrideDto?>
{
    public async Task<ProductAddOnPriceOverrideDto?> Handle(UpdateProductAddOnPriceOverrideCommand request, CancellationToken cancellationToken)
    {
        var productAddOnExists = await db.ProductAddOns
            .AnyAsync(pa => pa.ProductId == request.ProductId && pa.AddOnId == request.AddOnId, cancellationToken);

        if (!productAddOnExists)
        {
            return null;
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var existing = await db.ProductAddOnPriceOverrides
            .FirstOrDefaultAsync(o => o.ProductId == request.ProductId && o.AddOnId == request.AddOnId, cancellationToken);

        if (existing == null)
        {
            return null;
        }

        existing.Price = request.Price;
        existing.IsActive = request.IsActive;
        existing.UpdatedAt = DateTime.UtcNow;
        existing.UpdatedBy = userId;

        await db.SaveChangesAsync(cancellationToken);

        return new ProductAddOnPriceOverrideDto(
            existing.ProductId,
            existing.AddOnId,
            existing.Price,
            existing.IsActive
        );
    }
}
