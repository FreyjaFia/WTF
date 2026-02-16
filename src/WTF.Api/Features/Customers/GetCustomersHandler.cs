using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Contracts.Customers;
using WTF.Contracts.Customers.Queries;
using WTF.Domain.Data;

namespace WTF.Api.Features.Customers;

public class GetCustomersHandler(WTFDbContext db) : IRequestHandler<GetCustomersQuery, List<CustomerDto>>
{
    public async Task<List<CustomerDto>> Handle(GetCustomersQuery request, CancellationToken cancellationToken)
    {
        var query = db.Customers.AsQueryable();

        if (request.IsActive.HasValue)
        {
            query = query.Where(c => c.IsActive == request.IsActive.Value);
        }

        if (!string.IsNullOrWhiteSpace(request.SearchTerm))
        {
            var searchTerm = request.SearchTerm.ToLower();
            query = query.Where(c =>
                c.FirstName.ToLower().Contains(searchTerm) ||
                c.LastName.ToLower().Contains(searchTerm) ||
                (c.Address != null && c.Address.ToLower().Contains(searchTerm))
            );
        }

        var customers = await query
            .OrderBy(c => c.LastName)
            .ThenBy(c => c.FirstName)
            .Select(c => new CustomerDto(
                c.Id,
                c.FirstName,
                c.LastName,
                c.Address,
                c.IsActive
            ))
            .ToListAsync(cancellationToken);

        return customers;
    }
}
