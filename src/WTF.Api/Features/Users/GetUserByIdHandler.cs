using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Users.DTOs;
using WTF.Api.Features.Users.Enums;
using WTF.Domain.Data;

namespace WTF.Api.Features.Users;

public record GetUserByIdQuery(Guid Id) : IRequest<UserDto?>;

public class GetUserByIdHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetUserByIdQuery, UserDto?>
{
    public async Task<UserDto?> Handle(GetUserByIdQuery request, CancellationToken cancellationToken)
    {
        var user = await db.Users
            .Include(u => u.Role)
            .Include(u => u.UserImage)
                .ThenInclude(ui => ui!.Image)
            .FirstOrDefaultAsync(u => u.Id == request.Id, cancellationToken);

        if (user == null)
        {
            return null;
        }

        var imageUrl = user.UserImage != null && user.UserImage.Image != null
            ? user.UserImage.Image.ImageUrl
            : null;

        imageUrl = UrlExtensions.ToAbsoluteUrl(httpContextAccessor, imageUrl);

        return new UserDto(
            user.Id,
            user.FirstName,
            user.LastName,
            user.Username,
            user.IsActive,
            imageUrl,
            (UserRoleEnum)user.RoleId
        );
    }
}
