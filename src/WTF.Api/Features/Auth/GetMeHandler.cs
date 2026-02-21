using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Auth.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Auth;

public record GetMeQuery() : IRequest<MeDto?>;

public class GetMeHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetMeQuery, MeDto?>
{
    public async Task<MeDto?> Handle(GetMeQuery request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        var user = await db.Users
            .Include(u => u.UserImage)
                .ThenInclude(ui => ui!.Image)
            .FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);

        if (user == null)
        {
            return null;
        }

        var imageUrl = user.UserImage?.Image?.ImageUrl;
        imageUrl = UrlExtensions.ToAbsoluteUrl(httpContextAccessor, imageUrl);

        return new MeDto(
            user.FirstName,
            user.LastName,
            imageUrl
        );
    }
}
