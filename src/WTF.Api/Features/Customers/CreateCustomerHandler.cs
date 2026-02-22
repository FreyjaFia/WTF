using MediatR;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Customers.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Customers;

public record CreateCustomerCommand(string FirstName, string LastName, string? Address) : IRequest<CustomerDto>;

public class CreateCustomerHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<CreateCustomerCommand, CustomerDto>
{
    public async Task<CustomerDto> Handle(CreateCustomerCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        var customer = new Customer
        {
            FirstName = request.FirstName,
            LastName = request.LastName,
            Address = request.Address,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId
        };

        db.Customers.Add(customer);
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
