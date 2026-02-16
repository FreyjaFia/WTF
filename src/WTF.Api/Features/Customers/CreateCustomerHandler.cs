using MediatR;
using WTF.Contracts.Customers;
using WTF.Contracts.Customers.Commands;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Customers;

public class CreateCustomerHandler(WTFDbContext db) : IRequestHandler<CreateCustomerCommand, CustomerDto>
{
    public async Task<CustomerDto> Handle(CreateCustomerCommand request, CancellationToken cancellationToken)
    {
        var customer = new Customer
        {
            FirstName = request.FirstName,
            LastName = request.LastName,
            Address = request.Address
        };

        db.Customers.Add(customer);
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
