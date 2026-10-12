using Microsoft.EntityFrameworkCore;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Images;

/// <summary>
/// The one list of everything that can point at an <see cref="Image"/>. The stale image cleanup deletes images
/// that none of these use, so a new entity with an image reference MUST be added here (a test fails if one is missing).
/// </summary>
public static class ImageReferences
{
    /// <summary>Entity types that reference an image through an <c>ImageId</c> and a navigation back to <see cref="Image"/>.</summary>
    public static readonly IReadOnlyList<Type> ReferencingEntities =
    [
        typeof(CustomerImage),
        typeof(ProductImage),
        typeof(PromotionImage),
        typeof(UserImage)
    ];

    /// <summary>Loads each image with the rows that point to it, so they can be removed together.</summary>
    public static IQueryable<Image> WithLinks(IQueryable<Image> images) =>
        images.Include(i => i.CustomerImage)
            .Include(i => i.ProductImage)
            .Include(i => i.PromotionImage)
            .Include(i => i.UserImage);

    /// <summary>The link rows (<see cref="ReferencingEntities"/>) that point at this image. Needs <see cref="WithLinks"/>.</summary>
    public static IEnumerable<object> LinksOf(Image image)
    {
        if (image.CustomerImage != null) yield return image.CustomerImage;
        if (image.ProductImage != null) yield return image.ProductImage;
        if (image.PromotionImage != null) yield return image.PromotionImage;
        if (image.UserImage != null) yield return image.UserImage;
    }

    /// <summary>Images that no entity in <see cref="ReferencingEntities"/> points to.</summary>
    public static IQueryable<Image> Unreferenced(IQueryable<Image> images) =>
        images.Where(i => i.CustomerImage == null
            && i.ProductImage == null
            && i.PromotionImage == null
            && i.UserImage == null);
}
