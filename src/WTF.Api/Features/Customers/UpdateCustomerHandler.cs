using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Contracts.Customers;
using WTF.Contracts.Customers.Commands;
using WTF.Domain.Data;

namespace WTF.Api.Features.Customers;

public class UpdateCustomerHandler(WTFDbContext db) : IRequestHandler<UpdateCustomerCommand, CustomerDto?>
{
    public async Task<CustomerDto?> Handle(UpdateCustomerCommand request, CancellationToken cancellationToken)
    {
        var customer = await db.Customers
            .FirstOrDefaultAsync(c => c.Id == request.Id, cancellationToken);

        if (customer == null)
        {
            return null;
        }

        customer.FirstName = request.FirstName;
        customer.LastName = request.LastName;
        customer.Address = request.Address;

        await db.SaveChangesAsync(cancellationToken);

        return new CustomerDto(
            customer.Id,
            customer.FirstName,
            customer.LastName,
            customer.Address,
            customer.IsActive
        );
    }
}
