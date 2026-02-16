using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Contracts.Customers;
using WTF.Contracts.Customers.Queries;
using WTF.Domain.Data;

namespace WTF.Api.Features.Customers;

public class GetCustomerByIdHandler(WTFDbContext db) : IRequestHandler<GetCustomerByIdQuery, CustomerDto?>
{
    public async Task<CustomerDto?> Handle(GetCustomerByIdQuery request, CancellationToken cancellationToken)
    {
        var customer = await db.Customers
            .Where(c => c.Id == request.Id)
            .Select(c => new CustomerDto(
                c.Id,
                c.FirstName,
                c.LastName,
                c.Address,
                c.IsActive
            ))
            .FirstOrDefaultAsync(cancellationToken);

        return customer;
    }
}
