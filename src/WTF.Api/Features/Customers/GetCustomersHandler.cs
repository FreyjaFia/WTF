using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Contracts.Customers;
using WTF.Contracts.Customers.Queries;
using WTF.Domain.Data;

namespace WTF.Api.Features.Customers;

public class GetCustomersHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetCustomersQuery, List<CustomerDto>>
{
    public async Task<List<CustomerDto>> Handle(GetCustomersQuery request, CancellationToken cancellationToken)
    {
        var query = db.Customers
            .Include(c => c.CustomerImage)
                .ThenInclude(ci => ci!.Image)
            .AsQueryable();

        if (request.IsActive.HasValue)
        {
            query = query.Where(c => c.IsActive == request.IsActive.Value);
        }

        if (!string.IsNullOrWhiteSpace(request.SearchTerm))
        {
            var searchTerm = request.SearchTerm.ToLower();
            query = query.Where(c =>
                c.FirstName.Contains(searchTerm, StringComparison.CurrentCultureIgnoreCase) ||
                c.LastName.Contains(searchTerm, StringComparison.CurrentCultureIgnoreCase) ||
                (c.Address != null && c.Address.Contains(searchTerm, StringComparison.CurrentCultureIgnoreCase))
            );
        }

        var customers = await query
            .OrderBy(c => c.LastName)
            .ThenBy(c => c.FirstName)
            .ToListAsync(cancellationToken);

        return [.. customers.Select(c =>
        {
            var imageUrl = c.CustomerImage != null && c.CustomerImage.Image != null
                ? c.CustomerImage.Image.ImageUrl
                : null;

            imageUrl = UrlExtensions.ToAbsoluteUrl(httpContextAccessor, imageUrl);


        return new CustomerDto(
                c.Id,
                c.FirstName,
                c.LastName,
                c.Address,
                c.IsActive,
                imageUrl
            );
        })];
    }
}
