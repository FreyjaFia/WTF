using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Time;
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

        var deals = await LoadDealsAsync(products, cancellationToken);

        // The customer's own profile picture, so the page can show who it is ordering for.
        var imageUrl = await db.CustomerImages
            .Where(ci => ci.CustomerId == access.Customer.Id)
            .Select(ci => ci.Image.ImageUrl)
            .FirstOrDefaultAsync(cancellationToken);

        return new PublicOrderLinkDto(
            access.Customer.FirstName,
            access.Customer.Address,
            access.Customer.ContactNumber,
            UrlExtensions.ToAbsoluteUrl(httpContextAccessor, imageUrl),
            access.Link.ExpiresAt,
            new PublicCatalogDto(
                [.. products.Select(ToPublic)],
                addOns.ToDictionary(
                    pair => pair.Key,
                    pair => pair.Value
                        .Select(group => new PublicAddOnGroupDto(
                            (int)group.Type, group.DisplayName, [.. group.Options.Select(ToPublic)]))
                        .ToList()),
                deals));
    }


    // The discounts that are on right now, so the customer's cart can show the price the shop will charge. Only for
    // products the page can actually show, and never one that has run out of uses.
    private async Task<List<PublicDealDto>> LoadDealsAsync(
        List<ProductDto> products, CancellationToken cancellationToken)
    {
        var loaded = await DiscountRuleLoader.LoadAsync(
            db,
            DateTime.UtcNow,
            RequestTimeZone.ResolveFromRequest(httpContextAccessor),
            null,
            cancellationToken);

        var shown = products.Select(p => p.Id).ToHashSet();

        return [.. loaded.RulesByProductId
            .Where(pair => shown.Contains(pair.Key))
            .SelectMany(pair => pair.Value.Select(rule => (ProductId: pair.Key, Rule: rule)))
            .Select(x => (x.ProductId, x.Rule, Remaining: loaded.Budget.Remaining(x.Rule.PromotionId)))
            .Where(x => x.Remaining != 0)
            .Select(x => new PublicDealDto(
                x.ProductId,
                x.Rule.FixedPrice,
                x.Rule.PercentOff,
                [.. x.Rule.RequiredAddOns.Select(a => new PublicDealAddOnDto(a.AddOnProductId, a.Quantity))],
                x.Remaining))];
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
