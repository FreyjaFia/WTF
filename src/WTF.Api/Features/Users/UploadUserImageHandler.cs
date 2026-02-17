using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Contracts.Users;
using WTF.Contracts.Users.Commands;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Users;

public class UploadUserImageHandler(WTFDbContext db, IWebHostEnvironment env, IHttpContextAccessor httpContextAccessor) : IRequestHandler<UploadUserImageCommand, UserDto?>
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

        // Basic validation: file extension and size
        var allowed = new[] { ".jpg", ".jpeg", ".png", ".webp" };
        var extension = Path.GetExtension(request.FileName)?.ToLowerInvariant() ?? string.Empty;
        if (!allowed.Contains(extension))
        {
            return null;
        }

        if (request.ImageData == null || request.ImageData.Length == 0 || request.ImageData.Length > 5 * 1024 * 1024) // 5MB max
        {
            return null;
        }

        var userNameSlug = user.Username
            .ToLowerInvariant()
            .Replace(" ", "_")
            .Replace("-", "_");

        var fileName = $"{userNameSlug}_{Guid.NewGuid():N}{extension}";

        var imagesPath = Path.Combine(env.WebRootPath, "images", "users");
        if (!Directory.Exists(imagesPath))
        {
            Directory.CreateDirectory(imagesPath);
        }

        var filePath = Path.Combine(imagesPath, fileName);
        await File.WriteAllBytesAsync(filePath, request.ImageData, cancellationToken);

        var imageUrl = $"/images/users/{fileName}";

        // Delete old image if exists
        if (user.UserImage != null)
        {
            var oldImageUrl = user.UserImage.Image.ImageUrl;
            var oldFilePath = Path.Combine(env.WebRootPath, oldImageUrl.TrimStart('/'));
            if (File.Exists(oldFilePath))
            {
                File.Delete(oldFilePath);
            }
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

        return new UserDto(
            user.Id,
            user.FirstName,
            user.LastName,
            user.Username,
            user.IsActive,
            absoluteImageUrl
        );
    }
}