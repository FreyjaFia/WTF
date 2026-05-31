using WTF.Api.Common.Extensions;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Promotions;

internal static class MixMatchMapping
{
    public static MixMatchPromotionDto ToDto(Promotion promo, IHttpContextAccessor? httpContextAccessor)
    {
        var mixMatch = promo.MixMatchPromotion!;
        return new MixMatchPromotionDto(
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
            mixMatch.RequiredQuantity,
            mixMatch.MaxSelectionsPerOrder,
            mixMatch.BundlePrice,
            [.. mixMatch.MixMatchPromotionProducts
                .OrderBy(x => x.Id)
                .Select(item => new MixMatchItemDto(
                    item.Id,
                    item.ProductId,
                    [.. item.MixMatchPromotionProductAddOns
                        .OrderBy(x => x.AddOnProductId)
                        .Select(addOn => new MixMatchItemAddOnDto(
                            addOn.Id,
                            addOn.AddOnProductId,
                            addOn.Quantity))]))]);
    }

    public static MixMatchPromotion BuildMixMatch(CreateMixMatchPromotionCommand request)
    {
        return new MixMatchPromotion
        {
            RequiredQuantity = request.RequiredQuantity,
            MaxSelectionsPerOrder = request.MaxSelectionsPerOrder,
            BundlePrice = request.BundlePrice,
            MixMatchPromotionProducts = BuildMixMatchProducts(request.Items)
        };
    }

    public static List<MixMatchPromotionProduct> BuildMixMatchProducts(List<CreateMixMatchItemRequestDto> items)
    {
        return [.. items.Select(item => new MixMatchPromotionProduct
        {
            ProductId = item.ProductId,
            MixMatchPromotionProductAddOns = [.. item.AddOns.Select(addOn => new MixMatchPromotionProductAddOn
            {
                AddOnProductId = addOn.AddOnProductId,
                Quantity = addOn.Quantity
            })]
        })];
    }
}
