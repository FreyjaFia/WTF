using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Products.DTOs;
using WTF.Api.Features.Products.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Products;

public record RemoveProductImageCommand(Guid ProductId) : IRequest<ProductDto?>;

public class RemoveProductImageHandler(WTFDbContext db, IImageStorage imageStorage) : IRequestHandler<RemoveProductImageCommand, ProductDto?>
{
    public async Task<ProductDto?> Handle(RemoveProductImageCommand request, CancellationToken cancellationToken)
    {
        var product = await db.Products
            .Include(p => p.ProductImage)
                .ThenInclude(pi => pi!.Image)
            .FirstOrDefaultAsync(p => p.Id == request.ProductId, cancellationToken);

        if (product == null)
        {
            return null;
        }

        if (product.ProductImage != null)
        {
            var oldImageUrl = product.ProductImage.Image.ImageUrl;
            await imageStorage.DeleteAsync(oldImageUrl, cancellationToken);

            db.ProductImages.Remove(product.ProductImage);
            db.Images.Remove(product.ProductImage.Image);
            await db.SaveChangesAsync(cancellationToken);
        }

        var priceHistory = await db.ProductPriceHistories
            .Include(h => h.UpdatedByNavigation)
            .Where(h => h.ProductId == request.ProductId)
            .OrderByDescending(h => h.UpdatedAt)
            .Select(h => new ProductPriceHistoryDto(
                h.Id,
                h.ProductId,
                h.OldPrice,
                h.NewPrice,
                h.UpdatedAt,
                h.UpdatedBy,
                $"{h.UpdatedByNavigation.FirstName} {h.UpdatedByNavigation.LastName}"
            ))
            .ToListAsync(cancellationToken);

        return new ProductDto(
            product.Id,
            product.Name,
            product.Code,
            product.Description,
            product.Price,
            (ProductCategoryEnum)product.CategoryId,
            product.IsAddOn,
            product.IsActive,
            product.CreatedAt,
            product.CreatedBy,
            product.UpdatedAt,
            product.UpdatedBy,
            null,
            priceHistory
        );
    }
}
