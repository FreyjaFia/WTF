using WTF.Api.Features.Promotions;
using WTF.Domain.Entities;

namespace WTF.Tests.Features.Promotions;

public class MixMatchMappingTests
{
    [Fact]
    public void BuildMixMatch_CopiesRulesAndNestedProducts()
    {
        var productId = Guid.NewGuid();
        var addOnId = Guid.NewGuid();
        var command = new CreateMixMatchPromotionCommand
        {
            Name = "Mix",
            RequiredQuantity = 3,
            MaxSelectionsPerOrder = 2,
            BundlePrice = 199m,
            Items = [new(productId, [new(addOnId, 2)])]
        };

        var result = MixMatchMapping.BuildMixMatch(command);

        result.RequiredQuantity.ShouldBe(3);
        result.MaxSelectionsPerOrder.ShouldBe(2);
        result.BundlePrice.ShouldBe(199m);
        var product = result.MixMatchPromotionProducts.ShouldHaveSingleItem();
        product.ProductId.ShouldBe(productId);
        var addOn = product.MixMatchPromotionProductAddOns.ShouldHaveSingleItem();
        addOn.AddOnProductId.ShouldBe(addOnId);
        addOn.Quantity.ShouldBe(2);
    }

    [Fact]
    public void BuildMixMatchProducts_EmptyInput_ReturnsEmptyList()
    {
        MixMatchMapping.BuildMixMatchProducts([]).ShouldBeEmpty();
    }

    [Fact]
    public void ToDto_OrdersAddOnsAndMapsPromotionFields()
    {
        var productId = Guid.NewGuid();
        var low = new Guid("00000000-0000-0000-0000-000000000001");
        var high = new Guid("00000000-0000-0000-0000-000000000002");
        var promo = new Promotion
        {
            Id = Guid.NewGuid(),
            Name = "Mix",
            IsActive = true,
            MixMatchPromotion = new MixMatchPromotion
            {
                RequiredQuantity = 2,
                BundlePrice = 50m,
                MixMatchPromotionProducts =
                [
                    new MixMatchPromotionProduct
                    {
                        ProductId = productId,
                        MixMatchPromotionProductAddOns =
                        [
                            new MixMatchPromotionProductAddOn { AddOnProductId = high, Quantity = 1 },
                            new MixMatchPromotionProductAddOn { AddOnProductId = low, Quantity = 2 }
                        ]
                    }
                ]
            }
        };

        var dto = MixMatchMapping.ToDto(promo, null);

        dto.Name.ShouldBe("Mix");
        dto.RequiredQuantity.ShouldBe(2);
        dto.BundlePrice.ShouldBe(50m);
        dto.ImageUrl.ShouldBeNull();
        dto.Items.ShouldHaveSingleItem().AddOns.Select(a => a.AddOnProductId).ShouldBe([low, high]);
    }
}
