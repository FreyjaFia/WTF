using WTF.Api.Common.Extensions;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Promotions;

internal static class FixedBundleMapping
{
    public static FixedBundlePromotionDto ToDto(Promotion promo, IHttpContextAccessor? httpContextAccessor)
    {
        var fixedBundle = promo.FixedBundlePromotion!;
        return new FixedBundlePromotionDto(
            promo.Id,
            promo.Name,
            promo.IsActive,
            promo.StartDate,
            promo.EndDate,
            UrlExtensions.ToAbsoluteUrl(httpContextAccessor, promo.PromotionImage?.Image?.ImageUrl),
            promo.CreatedAt,
            promo.CreatedBy,
            promo.UpdatedAt,
            promo.UpdatedBy,
            fixedBundle.BundlePrice,
            [.. fixedBundle.FixedBundlePromotionItems
                .OrderBy(x => x.ProductId)
                .Select(item => new FixedBundleItemDto(
                    item.Id,
                    item.ProductId,
                    item.Quantity,
                    [.. item.FixedBundlePromotionItemAddOns
                        .OrderBy(x => x.AddOnProductId)
                        .Select(addOn => new FixedBundleItemAddOnDto(
                            addOn.Id,
                            addOn.AddOnProductId,
                            addOn.Quantity))]))]);
    }
}
