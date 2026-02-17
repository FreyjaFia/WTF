using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Contracts.Customers;
using WTF.Contracts.Customers.Queries;
using WTF.Domain.Data;

namespace WTF.Api.Features.Customers;

public class GetCustomerByIdHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetCustomerByIdQuery, CustomerDto?>
{
    public async Task<CustomerDto?> Handle(GetCustomerByIdQuery request, CancellationToken cancellationToken)
    {
        var customer = await db.Customers
            .Include(c => c.CustomerImage)
                .ThenInclude(ci => ci!.Image)
            .FirstOrDefaultAsync(c => c.Id == request.Id, cancellationToken);

        if (customer == null)
        {
            return null;
        }

        var imageUrl = customer.CustomerImage != null && customer.CustomerImage.Image != null
            ? customer.CustomerImage.Image.ImageUrl
            : null;

        imageUrl = UrlExtensions.ToAbsoluteUrl(httpContextAccessor, imageUrl);

        return new CustomerDto(
            customer.Id,
            customer.FirstName,
            customer.LastName,
            customer.Address,
            customer.IsActive,
            imageUrl
        );
    }
}
