using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Contracts.Customers.Commands;
using WTF.Domain.Data;

namespace WTF.Api.Features.Customers;

public class DeleteCustomerHandler(WTFDbContext db) : IRequestHandler<DeleteCustomerCommand, bool>
{
    public async Task<bool> Handle(DeleteCustomerCommand request, CancellationToken cancellationToken)
    {
        var customer = await db.Customers
            .FirstOrDefaultAsync(c => c.Id == request.Id, cancellationToken);

        if (customer == null)
        {
            return false;
        }

        customer.IsActive = false;
        await db.SaveChangesAsync(cancellationToken);

        return true;
    }
}
