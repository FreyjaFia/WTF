using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Services;
using WTF.Contracts.Users;
using WTF.Contracts.Users.Commands;
using WTF.Contracts.Users.Enums;
using WTF.Domain.Data;

namespace WTF.Api.Features.Users;

public class RemoveUserImageHandler(WTFDbContext db, IImageStorage imageStorage) : IRequestHandler<RemoveUserImageCommand, UserDto?>
{
    public async Task<UserDto?> Handle(RemoveUserImageCommand request, CancellationToken cancellationToken)
    {
        var user = await db.Users
            .Include(u => u.UserImage)
                .ThenInclude(ui => ui!.Image)
            .FirstOrDefaultAsync(u => u.Id == request.UserId, cancellationToken);

        if (user == null)
        {
            return null;
        }

        if (user.UserImage != null)
        {
            var oldImageUrl = user.UserImage.Image.ImageUrl;
            await imageStorage.DeleteAsync(oldImageUrl, cancellationToken);

            db.UserImages.Remove(user.UserImage);
            db.Images.Remove(user.UserImage.Image);
            await db.SaveChangesAsync(cancellationToken);
        }

        return new UserDto(
            user.Id,
            user.FirstName,
            user.LastName,
            user.Username,
            user.IsActive,
            null,
            (UserRoleEnum)user.RoleId
        );
    }
}
