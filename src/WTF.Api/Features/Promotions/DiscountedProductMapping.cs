using WTF.Api.Common.Extensions;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Promotions;

internal static class DiscountedProductMapping
{
    public static DiscountedProductPromotionDto ToDto(Promotion promo, IHttpContextAccessor? httpContextAccessor)
    {
        return new DiscountedProductPromotionDto(
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
            [.. promo.DiscountedProductPromotions
                .OrderBy(x => x.ProductId)
                .Select(discounted => new DiscountedProductItemDto(
                    discounted.Id,
                    discounted.ProductId,
                    discounted.FixedPrice,
                    discounted.PercentOff,
                    [.. discounted.DiscountedProductPromotionAddOns
                        .OrderBy(x => x.AddOnProductId)
                        .Select(addOn => new DiscountedProductAddOnDto(
                            addOn.Id,
                            addOn.AddOnProductId,
                            addOn.Quantity))]))]);
    }
}
