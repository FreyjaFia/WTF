using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Services;
using WTF.Contracts.Customers;
using WTF.Contracts.Customers.Commands;
using WTF.Domain.Data;

namespace WTF.Api.Features.Customers;

public class RemoveCustomerImageHandler(WTFDbContext db, IImageStorage imageStorage) : IRequestHandler<RemoveCustomerImageCommand, CustomerDto?>
{
    public async Task<CustomerDto?> Handle(RemoveCustomerImageCommand request, CancellationToken cancellationToken)
    {
        var customer = await db.Customers
            .Include(c => c.CustomerImage)
                .ThenInclude(ci => ci!.Image)
            .FirstOrDefaultAsync(c => c.Id == request.CustomerId, cancellationToken);

        if (customer == null)
        {
            return null;
        }

        if (customer.CustomerImage != null)
        {
            var oldImageUrl = customer.CustomerImage.Image.ImageUrl;
            await imageStorage.DeleteAsync(oldImageUrl, cancellationToken);

            db.CustomerImages.Remove(customer.CustomerImage);
            db.Images.Remove(customer.CustomerImage.Image);
            await db.SaveChangesAsync(cancellationToken);
        }

        return new CustomerDto(
            customer.Id,
            customer.FirstName,
            customer.LastName,
            customer.Address,
            customer.IsActive,
            null
        );
    }
}
