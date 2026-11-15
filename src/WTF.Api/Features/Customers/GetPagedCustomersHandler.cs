using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.DTOs;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Customers.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Customers;

public sealed record GetPagedCustomersQuery(
    string? SearchTerm = null,
    bool? IsActive = null,
    string? SortBy = null,
    string? SortDirection = null,
    int Page = 1,
    int PageSize = 25) : IRequest<PagedResultDto<CustomerDto>>;

public sealed class GetPagedCustomersHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<GetPagedCustomersQuery, PagedResultDto<CustomerDto>>
{
    public async Task<PagedResultDto<CustomerDto>> Handle(GetPagedCustomersQuery request, CancellationToken cancellationToken)
    {
        var paging = PagingRequest.From(request.Page, request.PageSize, 25);
        var searched = ApplySearch(db.Customers.AsQueryable(), request.SearchTerm);

        // Counts for the status chips follow the search but not the status itself.
        var counts = await searched
            .GroupBy(c => c.IsActive)
            .Select(g => new { IsActive = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        var facets = new Dictionary<string, int>
        {
            ["active"] = counts.Where(c => c.IsActive).Sum(c => c.Count),
            ["inactive"] = counts.Where(c => !c.IsActive).Sum(c => c.Count),
        };

        var query = request.IsActive.HasValue ? searched.Where(c => c.IsActive == request.IsActive.Value) : searched;
        var totalCount = await query.CountAsync(cancellationToken);
        if (totalCount == 0)
        {
            return new PagedResultDto<CustomerDto>([], paging.Page, paging.PageSize, 0, facets);
        }

        paging = paging.ClampToTotal(totalCount);

        var customers = await ApplySort(query, request)
            .ApplyPaging(paging)
            .Include(c => c.CustomerImage)
                .ThenInclude(ci => ci!.Image)
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        var items = customers.Select(c =>
        {
            var imageUrl = c.CustomerImage?.Image != null
                ? UrlExtensions.ToAbsoluteUrl(httpContextAccessor, c.CustomerImage.Image.ImageUrl)
                : null;

            return CustomerMapping.ToDto(c, imageUrl);
        }).ToList();

        return new PagedResultDto<CustomerDto>(items, paging.Page, paging.PageSize, totalCount, facets);
    }

    private static IQueryable<Customer> ApplySearch(IQueryable<Customer> query, string? searchTerm)
    {
        if (string.IsNullOrWhiteSpace(searchTerm))
        {
            return query;
        }

        var term = searchTerm.Trim().ToLower();
        var digits = new string(term.Where(char.IsDigit).ToArray());

        return query.Where(c =>
            c.FirstName.ToLower().Contains(term) ||
            (c.LastName != null && c.LastName.ToLower().Contains(term)) ||
            (c.FirstName + " " + (c.LastName ?? "")).ToLower().Contains(term) ||
            (c.Address != null && c.Address.ToLower().Contains(term)) ||
            (digits.Length > 0 && c.ContactNumber != null &&
                c.ContactNumber.Replace(" ", "").Replace("-", "").Replace("(", "").Replace(")", "").Replace("+", "").Contains(digits)));
    }

    private static IQueryable<Customer> ApplySort(IQueryable<Customer> query, GetPagedCustomersQuery request)
    {
        var descending = string.Equals(request.SortDirection, "desc", StringComparison.OrdinalIgnoreCase);

        if (string.Equals(request.SortBy, "address", StringComparison.OrdinalIgnoreCase))
        {
            return descending
                ? query.OrderByDescending(c => c.Address).ThenByDescending(c => c.Id)
                : query.OrderBy(c => c.Address).ThenBy(c => c.Id);
        }

        return descending
            ? query.OrderByDescending(c => c.FirstName).ThenByDescending(c => c.LastName).ThenByDescending(c => c.Id)
            : query.OrderBy(c => c.FirstName).ThenBy(c => c.LastName).ThenBy(c => c.Id);
    }
}
