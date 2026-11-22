using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.DTOs;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Users.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Users;

public sealed record GetPagedUsersQuery(
    string? SearchTerm = null,
    bool? IsActive = null,
    int[]? RoleIds = null,
    string? SortBy = null,
    string? SortDirection = null,
    int Page = 1,
    int PageSize = 25) : IRequest<PagedResultDto<UserDto>>;

public sealed class GetPagedUsersHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<GetPagedUsersQuery, PagedResultDto<UserDto>>
{
    public async Task<PagedResultDto<UserDto>> Handle(GetPagedUsersQuery request, CancellationToken cancellationToken)
    {
        var paging = PagingRequest.From(request.Page, request.PageSize, 25);
        var searched = ApplySearch(UserBranchVisibility.VisibleTo(db, httpContextAccessor.HttpContext!.User.GetUserId()), request.SearchTerm);
        var roleIds = request.RoleIds is { Length: > 0 } ? request.RoleIds : null;

        var withRoles = roleIds is null ? searched : searched.Where(u => roleIds.Contains(u.RoleId));
        var withStatus = request.IsActive.HasValue ? searched.Where(u => u.IsActive == request.IsActive.Value) : searched;

        // Each group of chips counts with every filter except its own.
        var statusCounts = await withRoles
            .GroupBy(u => u.IsActive)
            .Select(g => new { IsActive = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        var roleCounts = await withStatus
            .GroupBy(u => u.RoleId)
            .Select(g => new { RoleId = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);

        var facets = new Dictionary<string, int>
        {
            ["active"] = statusCounts.Where(c => c.IsActive).Sum(c => c.Count),
            ["inactive"] = statusCounts.Where(c => !c.IsActive).Sum(c => c.Count),
        };
        foreach (var count in roleCounts)
        {
            facets[$"role:{count.RoleId}"] = count.Count;
        }

        var query = withStatus;
        if (roleIds is not null)
        {
            query = query.Where(u => roleIds.Contains(u.RoleId));
        }

        var totalCount = await query.CountAsync(cancellationToken);
        if (totalCount == 0)
        {
            return new PagedResultDto<UserDto>([], paging.Page, paging.PageSize, 0, facets);
        }

        paging = paging.ClampToTotal(totalCount);

        var users = await ApplySort(query, request)
            .ApplyPaging(paging)
            .Include(u => u.Role)
            .Include(u => u.UserImage)
                .ThenInclude(ui => ui!.Image)
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        var items = users.Select(u =>
        {
            var imageUrl = u.UserImage?.Image != null
                ? UrlExtensions.ToAbsoluteUrl(httpContextAccessor, u.UserImage.Image.ImageUrl)
                : null;

            return UserMapping.ToDto(u, imageUrl);
        }).ToList();

        return new PagedResultDto<UserDto>(items, paging.Page, paging.PageSize, totalCount, facets);
    }

    private static IQueryable<User> ApplySearch(IQueryable<User> query, string? searchTerm)
    {
        if (string.IsNullOrWhiteSpace(searchTerm))
        {
            return query;
        }

        var term = searchTerm.Trim().ToLower();

        return query.Where(u =>
            u.FirstName.ToLower().Contains(term) ||
            u.LastName.ToLower().Contains(term) ||
            (u.FirstName + " " + u.LastName).ToLower().Contains(term) ||
            u.Username.ToLower().Contains(term));
    }

    private static IQueryable<User> ApplySort(IQueryable<User> query, GetPagedUsersQuery request)
    {
        var descending = string.Equals(request.SortDirection, "desc", StringComparison.OrdinalIgnoreCase);

        if (string.Equals(request.SortBy, "role", StringComparison.OrdinalIgnoreCase))
        {
            return descending
                ? query.OrderByDescending(u => u.Role.Name).ThenByDescending(u => u.Id)
                : query.OrderBy(u => u.Role.Name).ThenBy(u => u.Id);
        }

        return descending
            ? query.OrderByDescending(u => u.FirstName).ThenByDescending(u => u.LastName).ThenByDescending(u => u.Id)
            : query.OrderBy(u => u.FirstName).ThenBy(u => u.LastName).ThenBy(u => u.Id);
    }
}
