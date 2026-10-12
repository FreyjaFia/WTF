using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Products.DTOs;
using WTF.Api.Features.Products.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Products;

public record UploadProductImageCommand(Guid ProductId, byte[] ImageData, string FileName) : IRequest<ProductDto?>;

public class UploadProductImageHandler(WTFDbContext db, IImageStorage imageStorage, IHttpContextAccessor httpContextAccessor) : IRequestHandler<UploadProductImageCommand, ProductDto?>
{
    public async Task<ProductDto?> Handle(UploadProductImageCommand request, CancellationToken cancellationToken)
    {
        var product = await db.Products
            .Include(p => p.ProductImage)
                .ThenInclude(pi => pi!.Image)
            .FirstOrDefaultAsync(p => p.Id == request.ProductId, cancellationToken);

        if (product == null)
        {
            return null;
        }

        // The real type, size and pixels are checked, and the picture is cleaned and written out again (the same rules for
        // every upload, in ImageUploads). A refusal is explained to the sender as a 400.
        var processed = ImageUploads.Prepare(request.ImageData);

        // Generate filename from product name (lowercase with underscores)
        var productNameSlug = product.Name
            .ToLowerInvariant()
            .Replace(" ", "_")
            .Replace("-", "_");

        var fileName = $"{productNameSlug}_{Guid.NewGuid():N}{processed.Extension}";

        var imageUrl = await imageStorage.SaveAsync("products", fileName, processed.Data, cancellationToken);

        // Delete old image if exists
        if (product.ProductImage != null)
        {
            var oldImageUrl = product.ProductImage.Image.ImageUrl;
            await imageStorage.DeleteAsync(oldImageUrl, cancellationToken);

            db.ProductImages.Remove(product.ProductImage);
            db.Images.Remove(product.ProductImage.Image);
        }

        // Create Image record
        var image = new Image
        {
            ImageId = Guid.NewGuid(),
            ImageUrl = imageUrl,
            UploadedAt = DateTime.UtcNow
        };
        db.Images.Add(image);

        // Create ProductImage record
        var productImage = new ProductImage
        {
            ProductId = product.Id,
            ImageId = image.ImageId
        };
        db.ProductImages.Add(productImage);

        await db.SaveChangesAsync(cancellationToken);

        var absoluteImageUrl = UrlExtensions.ToAbsoluteUrl(httpContextAccessor, imageUrl);

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

        return ProductMapping.ToDto(product, absoluteImageUrl, priceHistory);
    }
}
