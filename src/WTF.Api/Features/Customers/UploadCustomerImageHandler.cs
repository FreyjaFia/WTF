using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Customers.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Customers;

public record UploadCustomerImageCommand(Guid CustomerId, byte[] ImageData, string FileName) : IRequest<CustomerDto?>;

public class UploadCustomerImageHandler(WTFDbContext db, IImageStorage imageStorage, IHttpContextAccessor httpContextAccessor) : IRequestHandler<UploadCustomerImageCommand, CustomerDto?>
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

        // The real type, size and pixels are checked, and the picture is cleaned and written out again (the same rules for
        // every upload, in ImageUploads). A refusal is explained to the sender as a 400.
        var processed = ImageUploads.Prepare(request.ImageData);

        var nameSlug = (customer.FirstName + "_" + customer.LastName)
            .ToLowerInvariant()
            .Replace(" ", "_")
            .Replace("-", "_");

        var fileName = $"{nameSlug}_{Guid.NewGuid():N}{processed.Extension}";

        var imageUrl = await imageStorage.SaveAsync("customers", fileName, processed.Data, cancellationToken);

        // Delete old image file and db rows if exists
        if (customer.CustomerImage != null)
        {
            var oldImageUrl = customer.CustomerImage.Image.ImageUrl;
            await imageStorage.DeleteAsync(oldImageUrl, cancellationToken);
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

        return CustomerMapping.ToDto(customer, absoluteImageUrl);
    }
}
