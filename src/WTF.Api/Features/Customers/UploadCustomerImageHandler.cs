using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Contracts.Customers;
using WTF.Contracts.Customers.Commands;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Customers;

public class UploadCustomerImageHandler(WTFDbContext db, IWebHostEnvironment env, IHttpContextAccessor httpContextAccessor) : IRequestHandler<UploadCustomerImageCommand, CustomerDto?>
{
    public async Task<CustomerDto?> Handle(UploadCustomerImageCommand request, CancellationToken cancellationToken)
    {
        var customer = await db.Customers
            .Include(c => c.CustomerImage)
                .ThenInclude(ci => ci!.Image)
            .FirstOrDefaultAsync(c => c.Id == request.CustomerId, cancellationToken);

        if (customer == null)
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

        var nameSlug = (customer.FirstName + "_" + customer.LastName)
            .ToLowerInvariant()
            .Replace(" ", "_")
            .Replace("-", "_");

        var fileName = $"{nameSlug}_{Guid.NewGuid():N}{extension}";

        var imagesPath = Path.Combine(env.WebRootPath, "images", "customers");
        if (!Directory.Exists(imagesPath))
        {
            Directory.CreateDirectory(imagesPath);
        }

        var filePath = Path.Combine(imagesPath, fileName);
        await File.WriteAllBytesAsync(filePath, request.ImageData, cancellationToken);

        var imageUrl = $"/images/customers/{fileName}";

        // Delete old image file and db rows if exists
        if (customer.CustomerImage != null)
        {
            var oldImageUrl = customer.CustomerImage.Image.ImageUrl;
            var oldFilePath = Path.Combine(env.WebRootPath, oldImageUrl.TrimStart('/'));
            if (File.Exists(oldFilePath))
            {
                File.Delete(oldFilePath);
            }
            db.CustomerImages.Remove(customer.CustomerImage);
            db.Images.Remove(customer.CustomerImage.Image);
        }

        var image = new Image
        {
            ImageId = Guid.NewGuid(),
            ImageUrl = imageUrl,
            UploadedAt = DateTime.UtcNow
        };
        db.Images.Add(image);

        var customerImage = new CustomerImage
        {
            CustomerId = customer.Id,
            ImageId = image.ImageId
        };
        db.CustomerImages.Add(customerImage);

        await db.SaveChangesAsync(cancellationToken);

        var absoluteImageUrl = UrlExtensions.ToAbsoluteUrl(httpContextAccessor, imageUrl);

        return new CustomerDto(
            customer.Id,
            customer.FirstName,
            customer.LastName,
            customer.Address,
            customer.IsActive,
            absoluteImageUrl
        );
    }
}
