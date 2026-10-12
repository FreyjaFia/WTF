using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Users.DTOs;
using WTF.Api.Features.Users.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Users;

public record UploadUserImageCommand(Guid UserId, byte[] ImageData, string FileName) : IRequest<UserDto?>;

public class UploadUserImageHandler(WTFDbContext db, IImageStorage imageStorage, IHttpContextAccessor httpContextAccessor) : IRequestHandler<UploadUserImageCommand, UserDto?>
{
    public async Task<UserDto?> Handle(UploadUserImageCommand request, CancellationToken cancellationToken)
    {
        var user = await db.Users
            .Include(u => u.UserImage)
                .ThenInclude(ui => ui!.Image)
            .FirstOrDefaultAsync(u => u.Id == request.UserId, cancellationToken);

        if (user == null)
        {
            return null;
        }

        // The real type, size and pixels are checked, and the picture is cleaned and written out again (the same rules for
        // every upload, in ImageUploads). A refusal is explained to the sender as a 400.
        var processed = ImageUploads.Prepare(request.ImageData);

        var userNameSlug = user.Username
            .ToLowerInvariant()
            .Replace(" ", "_")
            .Replace("-", "_");

        var fileName = $"{userNameSlug}_{Guid.NewGuid():N}{processed.Extension}";

        var imageUrl = await imageStorage.SaveAsync("users", fileName, processed.Data, cancellationToken);

        // Delete old image if exists
        if (user.UserImage != null)
        {
            var oldImageUrl = user.UserImage.Image.ImageUrl;
            await imageStorage.DeleteAsync(oldImageUrl, cancellationToken);
            db.UserImages.Remove(user.UserImage);
            db.Images.Remove(user.UserImage.Image);
        }

        var image = new Image
        {
            ImageId = Guid.NewGuid(),
            ImageUrl = imageUrl,
            UploadedAt = DateTime.UtcNow
        };
        db.Images.Add(image);

        var userImage = new UserImage
        {
            UserId = user.Id,
            ImageId = image.ImageId
        };
        db.UserImages.Add(userImage);

        await db.SaveChangesAsync(cancellationToken);

        // At this point DB was updated. Old files were already deleted above when user.UserImage existed.
        var absoluteImageUrl = UrlExtensions.ToAbsoluteUrl(httpContextAccessor, imageUrl);

        return UserMapping.ToDto(user, absoluteImageUrl);
    }
}
