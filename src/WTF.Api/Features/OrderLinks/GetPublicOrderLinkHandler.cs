using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.OrderLinks.DTOs;
using WTF.Api.Features.Products.DTOs;
using WTF.Api.Features.Sync;
using WTF.Domain.Data;

namespace WTF.Api.Features.OrderLinks;

public record GetPublicOrderLinkQuery(string Token) : IRequest<PublicOrderLinkDto?>;

public class GetPublicOrderLinkHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<GetPublicOrderLinkQuery, PublicOrderLinkDto?>
{
    // Opening the page repeatedly should not write to the database every time.
    private static readonly TimeSpan LastUsedGranularity = TimeSpan.FromMinutes(1);

    public async Task<PublicOrderLinkDto?> Handle(GetPublicOrderLinkQuery request, CancellationToken cancellationToken)
    {
        var access = await OrderLinkAccess.ResolveAsync(db, request.Token, cancellationToken);
        if (access == null)
        {
            return null;
        }

        var now = DateTime.UtcNow;
        if (!access.Link.LastUsedAt.HasValue || now - access.Link.LastUsedAt.Value >= LastUsedGranularity)
        {
            access.Link.LastUsedAt = now;
            await db.SaveChangesAsync(cancellationToken);
        }

        var products = await PosCatalogLoader.LoadProductsAsync(db, httpContextAccessor, cancellationToken);
        var addOns = await PosCatalogLoader.LoadAddOnsByProductIdAsync(
            db, httpContextAccessor, products, cancellationToken);

        // The customer's own profile picture, so the page can show who it is ordering for.
        var imageUrl = await db.CustomerImages
            .Where(ci => ci.CustomerId == access.Customer.Id)
            .Select(ci => ci.Image.ImageUrl)
            .FirstOrDefaultAsync(cancellationToken);

        return new PublicOrderLinkDto(
            access.Customer.FirstName,
            access.Customer.Address,
            UrlExtensions.ToAbsoluteUrl(httpContextAccessor, imageUrl),
            access.Link.ExpiresAt,
            new PublicCatalogDto(
                [.. products.Select(ToPublic)],
                addOns.ToDictionary(
                    pair => pair.Key,
                    pair => pair.Value
                        .Select(group => new PublicAddOnGroupDto(
                            (int)group.Type, group.DisplayName, [.. group.Options.Select(ToPublic)]))
                        .ToList())));
    }

    private static PublicProductDto ToPublic(ProductDto product) => new(
        product.Id,
        product.Name,
        product.Description,
        product.EffectivePrice,
        (int)product.Category,
        product.SubCategory.HasValue ? (int)product.SubCategory.Value : null,
        product.ImageUrl,
        product.AddOnCount);
}
