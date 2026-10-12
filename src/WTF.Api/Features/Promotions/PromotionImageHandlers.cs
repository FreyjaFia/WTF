using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Promotions;

public record UploadPromotionImageCommand(Guid PromotionId, byte[] ImageData, string FileName)
    : IRequest<PromotionImageDto?>;

public sealed class UploadPromotionImageHandler(
    WTFDbContext db,
    IImageStorage imageStorage,
    IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<UploadPromotionImageCommand, PromotionImageDto?>
{
    public async Task<PromotionImageDto?> Handle(UploadPromotionImageCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var promo = await db.Promotions
            .Include(x => x.PromotionImage!)
                .ThenInclude(x => x.Image)
            .FirstOrDefaultAsync(x => x.Id == request.PromotionId, cancellationToken);

        if (promo is null)
        {
            return null;
        }

        // The real type, size and pixels are checked, and the picture is cleaned and written out again (the same rules for
        // every upload, in ImageUploads). A refusal is explained to the sender as a 400.
        var processed = ImageUploads.Prepare(request.ImageData);

        var promoNameSlug = promo.Name
            .ToLowerInvariant()
            .Replace(" ", "_")
            .Replace("-", "_");

        var fileName = $"{promoNameSlug}_{Guid.NewGuid():N}{processed.Extension}";
        var imageUrl = await imageStorage.SaveAsync("promotions", fileName, processed.Data, cancellationToken);

        if (promo.PromotionImage?.Image is not null)
        {
            await imageStorage.DeleteAsync(promo.PromotionImage.Image.ImageUrl, cancellationToken);
            db.PromotionImages.Remove(promo.PromotionImage);
            db.Images.Remove(promo.PromotionImage.Image);
        }

        var image = new Image
        {
            ImageId = Guid.NewGuid(),
            ImageUrl = imageUrl,
            UploadedAt = DateTime.UtcNow
        };
        db.Images.Add(image);

        db.PromotionImages.Add(new PromotionImage
        {
            PromotionId = promo.Id,
            ImageId = image.ImageId
        });
        promo.UpdatedAt = DateTime.UtcNow;
        promo.UpdatedBy = userId;

        await db.SaveChangesAsync(cancellationToken);

        return new PromotionImageDto(
            promo.Id,
            UrlExtensions.ToAbsoluteUrl(httpContextAccessor, imageUrl));
    }
}

public record RemovePromotionImageCommand(Guid PromotionId) : IRequest<PromotionImageDto?>;

public sealed class RemovePromotionImageHandler(WTFDbContext db, IImageStorage imageStorage, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<RemovePromotionImageCommand, PromotionImageDto?>
{
    public async Task<PromotionImageDto?> Handle(RemovePromotionImageCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var promo = await db.Promotions
            .Include(x => x.PromotionImage!)
                .ThenInclude(x => x.Image)
            .FirstOrDefaultAsync(x => x.Id == request.PromotionId, cancellationToken);

        if (promo is null)
        {
            return null;
        }

        if (promo.PromotionImage?.Image is not null)
        {
            await imageStorage.DeleteAsync(promo.PromotionImage.Image.ImageUrl, cancellationToken);
            db.PromotionImages.Remove(promo.PromotionImage);
            db.Images.Remove(promo.PromotionImage.Image);
            promo.UpdatedAt = DateTime.UtcNow;
            promo.UpdatedBy = userId;
            await db.SaveChangesAsync(cancellationToken);
        }

        return new PromotionImageDto(promo.Id, null);
    }
}
