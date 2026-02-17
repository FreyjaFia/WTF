using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Contracts.Products;
using WTF.Contracts.Products.Commands;
using WTF.Contracts.Products.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Products;

public class UploadProductImageHandler(WTFDbContext db, IWebHostEnvironment env, IHttpContextAccessor httpContextAccessor) : IRequestHandler<UploadProductImageCommand, ProductDto?>
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

        // Basic validation: file extension and size
        var allowed = new[] { ".jpg", ".jpeg", ".png", ".webp" };
        var extension = Path.GetExtension(request.FileName)?.ToLowerInvariant() ?? string.Empty;
        if (!allowed.Contains(extension))
        {
            return null;
        }

        if (request.ImageData == null || request.ImageData.Length == 0 || request.ImageData.Length > 5 * 1024 * 1024) // 5MB max
        {
            return null;
        }

        // Generate filename from product name (lowercase with underscores)
        var productNameSlug = product.Name
            .ToLowerInvariant()
            .Replace(" ", "_")
            .Replace("-", "_");

        var fileName = $"{productNameSlug}_{Guid.NewGuid():N}{extension}";

        // Ensure wwwroot/images/products directory exists
        var imagesPath = Path.Combine(env.WebRootPath, "images", "products");
        if (!Directory.Exists(imagesPath))
        {
            Directory.CreateDirectory(imagesPath);
        }

        var filePath = Path.Combine(imagesPath, fileName);

        // Save file to disk
        await File.WriteAllBytesAsync(filePath, request.ImageData, cancellationToken);

        // Generate relative URL
        var imageUrl = $"/images/products/{fileName}";

        // Delete old image if exists
        if (product.ProductImage != null)
        {
            var oldImageUrl = product.ProductImage.Image.ImageUrl;
            var oldFilePath = Path.Combine(env.WebRootPath, oldImageUrl.TrimStart('/'));

            if (File.Exists(oldFilePath))
            {
                File.Delete(oldFilePath);
            }

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
            absoluteImageUrl,
            priceHistory
        );
    }
}
