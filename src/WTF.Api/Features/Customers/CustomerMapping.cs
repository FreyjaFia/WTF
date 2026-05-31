using WTF.Api.Features.Customers.DTOs;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Customers;

internal static class CustomerMapping
{
    public static CustomerDto ToDto(Customer customer, string? imageUrl)
    {
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
            imageUrl
        );
    }
}
