using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Customers.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Customers;

public record GetCustomersQuery : IRequest<List<CustomerDto>>
{
    public string? SearchTerm { get; init; }
    public bool? IsActive { get; init; } = true;
}

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
                c.FirstName.ToLower().Contains(searchTerm) ||
                c.LastName.ToLower().Contains(searchTerm) ||
                (c.Address != null && c.Address.ToLower().Contains(searchTerm))
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

            return CustomerMapping.ToDto(c, imageUrl);
        })];
    }
}
