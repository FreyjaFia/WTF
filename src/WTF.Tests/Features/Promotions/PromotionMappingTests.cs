using WTF.Api.Features.Promotions;
using WTF.Domain.Entities;

namespace WTF.Tests.Features.Promotions;

public class PromotionMappingTests
{
    private static readonly Guid Id1 = new("00000000-0000-0000-0000-000000000001");
    private static readonly Guid Id2 = new("00000000-0000-0000-0000-000000000002");

    private static Promotion BasePromo() => new()
    {
        Id = Guid.NewGuid(), Name = "P", IsActive = true,
        StartDate = new DateTime(2025, 1, 1), EndDate = new DateTime(2025, 2, 1),
        CreatedAt = new DateTime(2025, 1, 1), CreatedBy = Guid.NewGuid()
    };

    [Fact]
    public void DiscountedToDto_OrdersItemsAndAddOnsById_AndMapsFields()
    {
        var promo = BasePromo();
        promo.DiscountedProductPromotions.Add(new DiscountedProductPromotion { ProductId = Id2, PercentOff = 10 });
        var first = new DiscountedProductPromotion { ProductId = Id1, FixedPrice = 50 };
        first.DiscountedProductPromotionAddOns.Add(new DiscountedProductPromotionAddOn { AddOnProductId = Id2, Quantity = 2 });
        first.DiscountedProductPromotionAddOns.Add(new DiscountedProductPromotionAddOn { AddOnProductId = Id1, Quantity = 1 });
        promo.DiscountedProductPromotions.Add(first);

        var dto = DiscountedProductMapping.ToDto(promo, null);

        dto.Name.ShouldBe("P");
        dto.IsActive.ShouldBeTrue();
        dto.ImageUrl.ShouldBeNull();
        dto.Items.Select(i => i.ProductId).ShouldBe(new[] { Id1, Id2 });
        dto.Items[0].FixedPrice.ShouldBe(50);
        dto.Items[0].PercentOff.ShouldBeNull();
        dto.Items[1].PercentOff.ShouldBe(10);
        dto.Items[0].AddOns.Select(a => a.AddOnProductId).ShouldBe(new[] { Id1, Id2 });
        dto.Items[0].AddOns[1].Quantity.ShouldBe(2);
        dto.Items[1].AddOns.ShouldBeEmpty();
    }

    [Fact]
    public void DiscountedToDto_AbsoluteImageUrl_IsPassedThrough()
    {
        var promo = BasePromo();
        promo.PromotionImage = new PromotionImage { Image = new Image { ImageUrl = "https://cdn.test/a.png" } };

        DiscountedProductMapping.ToDto(promo, null).ImageUrl.ShouldBe("https://cdn.test/a.png");
    }

    [Fact]
    public void FixedBundleToDto_MapsBundlePriceAndOrdersItems()
    {
        var promo = BasePromo();
        var bundle = new FixedBundlePromotion { BundlePrice = 199m };
        var item2 = new FixedBundlePromotionItem { ProductId = Id2, Quantity = 3 };
        var item1 = new FixedBundlePromotionItem { ProductId = Id1, Quantity = 1 };
        item1.FixedBundlePromotionItemAddOns.Add(new FixedBundlePromotionItemAddOn { AddOnProductId = Id2, Quantity = 2 });
        item1.FixedBundlePromotionItemAddOns.Add(new FixedBundlePromotionItemAddOn { AddOnProductId = Id1, Quantity = 1 });
        bundle.FixedBundlePromotionItems.Add(item2);
        bundle.FixedBundlePromotionItems.Add(item1);
        promo.FixedBundlePromotion = bundle;

        var dto = FixedBundleMapping.ToDto(promo, null);

        dto.BundlePrice.ShouldBe(199m);
        dto.Items.Select(i => i.ProductId).ShouldBe(new[] { Id1, Id2 });
        dto.Items[1].Quantity.ShouldBe(3);
        dto.Items[0].AddOns.Select(a => a.AddOnProductId).ShouldBe(new[] { Id1, Id2 });
    }

    [Fact]
    public void FixedBundleToDto_MissingBundle_Throws()
    {
        Should.Throw<NullReferenceException>(() => FixedBundleMapping.ToDto(BasePromo(), null));
    }
}
