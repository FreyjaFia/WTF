using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Customers.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Customers;

public record UpdateCustomerCommand(Guid Id, string FirstName, string LastName, string? Address) : IRequest<CustomerDto?>;

public class UpdateCustomerHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<UpdateCustomerCommand, CustomerDto?>
{
    public async Task<CustomerDto?> Handle(UpdateCustomerCommand request, CancellationToken cancellationToken)
    {
        var customer = await db.Customers
            .FirstOrDefaultAsync(c => c.Id == request.Id, cancellationToken);

        if (customer == null)
        {
            return null;
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        customer.FirstName = request.FirstName;
        customer.LastName = request.LastName;
        customer.Address = request.Address;
        customer.UpdatedAt = DateTime.UtcNow;
        customer.UpdatedBy = userId;

        await db.SaveChangesAsync(cancellationToken);

        return new CustomerDto(
            customer.Id,
            customer.FirstName,
            customer.LastName,
            customer.Address,
            customer.IsActive,
            customer.CreatedAt,
            customer.CreatedBy,
            customer.UpdatedAt,
            customer.UpdatedBy,
            null
        );
    }
}
