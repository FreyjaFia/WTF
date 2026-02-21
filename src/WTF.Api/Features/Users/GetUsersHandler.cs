using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Users.DTOs;
using WTF.Api.Features.Users.Enums;
using WTF.Domain.Data;

namespace WTF.Api.Features.Users;

public record GetUsersQuery : IRequest<List<UserDto>>
{
    public bool? IsActive { get; init; } = true;
    public string? SearchTerm { get; init; }
}

public class GetUsersHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetUsersQuery, List<UserDto>>
{
    public async Task<List<UserDto>> Handle(GetUsersQuery request, CancellationToken cancellationToken)
    {
        var query = db.Users.AsQueryable();

        if (request.IsActive.HasValue)
        {
            query = query.Where(u => u.IsActive == request.IsActive.Value);
        }

        if (!string.IsNullOrWhiteSpace(request.SearchTerm))
        {
            var searchTerm = request.SearchTerm.ToLower();
            query = query.Where(u =>
                u.FirstName.Contains(searchTerm, StringComparison.CurrentCultureIgnoreCase) ||
                u.LastName.Contains(searchTerm, StringComparison.CurrentCultureIgnoreCase) ||
                u.Username.Contains(searchTerm, StringComparison.CurrentCultureIgnoreCase)
            );
        }

        var users = await query
            .Include(u => u.Role)
            .Include(u => u.UserImage)
                .ThenInclude(ui => ui.Image)
            .OrderBy(u => u.LastName)
            .ThenBy(u => u.FirstName)
            .ToListAsync(cancellationToken);

        return [.. users.Select(u =>
        {
            var imageUrl = u.UserImage != null && u.UserImage.Image != null
                ? u.UserImage.Image.ImageUrl
                : null;

            imageUrl = UrlExtensions.ToAbsoluteUrl(httpContextAccessor, imageUrl);

            return new UserDto(
                u.Id,
                u.FirstName,
                u.LastName,
                u.Username,
                u.IsActive,
                imageUrl,
                (UserRoleEnum)u.RoleId
            );
        })];
    }
}
