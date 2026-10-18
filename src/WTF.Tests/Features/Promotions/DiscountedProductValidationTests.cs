using WTF.Api.Features.Promotions;

namespace WTF.Tests.Features.Promotions;

public class DiscountedProductValidationTests
{
    private static CreateDiscountedProductItemRequestDto Item(
        decimal? fixedPrice = 50m,
        decimal? percentOff = null,
        Guid? productId = null,
        int addOnQuantity = 1) =>
        new(productId ?? Guid.NewGuid(), fixedPrice, percentOff, [new(Guid.NewGuid(), addOnQuantity)]);

    [Fact]
    public void EnsureValid_FixedPrice_DoesNotThrow()
    {
        Should.NotThrow(() => DiscountedProductValidation.EnsureValid("Promo", null, null, [Item()]));
    }

    [Fact]
    public void EnsureValid_PercentOff_DoesNotThrow()
    {
        Should.NotThrow(() => DiscountedProductValidation.EnsureValid("Promo", null, null, [Item(null, 15m)]));
    }

    [Fact]
    public void EnsureValid_PercentOffExactly100_IsAllowed()
    {
        Should.NotThrow(() => DiscountedProductValidation.EnsureValid("Promo", null, null, [Item(null, 100m)]));
    }

    [Fact]
    public void EnsureValid_BlankName_Throws()
    {
        Should.Throw<InvalidOperationException>(() => DiscountedProductValidation.EnsureValid("", null, null, [Item()]))
            .Message.ShouldBe("Promotion name is required.");
    }

    [Fact]
    public void EnsureValid_EndBeforeStart_Throws()
    {
        Should.Throw<InvalidOperationException>(() =>
                DiscountedProductValidation.EnsureValid("Promo", new DateTime(2025, 1, 2), new DateTime(2025, 1, 1), [Item()]))
            .Message.ShouldBe("End date cannot be earlier than start date.");
    }

    [Fact]
    public void EnsureValid_NoItems_Throws()
    {
        Should.Throw<InvalidOperationException>(() => DiscountedProductValidation.EnsureValid("Promo", null, null, []))
            .Message.ShouldBe("At least one discounted product is required.");
    }

    [Fact]
    public void EnsureValid_DuplicateProducts_Throws()
    {
        var id = Guid.NewGuid();

        Should.Throw<InvalidOperationException>(() =>
                DiscountedProductValidation.EnsureValid("Promo", null, null, [Item(productId: id), Item(productId: id)]))
            .Message.ShouldBe("Each discounted product must be unique.");
    }

    [Fact]
    public void EnsureValid_EmptyProductId_Throws()
    {
        Should.Throw<InvalidOperationException>(() =>
                DiscountedProductValidation.EnsureValid("Promo", null, null, [Item(productId: Guid.Empty)]))
            .Message.ShouldBe("Each discounted item must have a product.");
    }

    [Fact]
    public void EnsureValid_NeitherFixedNorPercent_Throws()
    {
        Should.Throw<InvalidOperationException>(() =>
                DiscountedProductValidation.EnsureValid("Promo", null, null, [Item(null, null)]))
            .Message.ShouldBe("Each discounted product must have an amount off or a percent discount.");
    }

    [Fact]
    public void EnsureValid_ZeroValuesCountAsMissing_Throws()
    {
        Should.Throw<InvalidOperationException>(() =>
                DiscountedProductValidation.EnsureValid("Promo", null, null, [Item(0m, 0m)]))
            .Message.ShouldBe("Each discounted product must have an amount off or a percent discount.");
    }

    [Fact]
    public void EnsureValid_BothFixedAndPercent_Throws()
    {
        Should.Throw<InvalidOperationException>(() =>
                DiscountedProductValidation.EnsureValid("Promo", null, null, [Item(10m, 10m)]))
            .Message.ShouldBe("Choose either an amount off or a percent discount, not both.");
    }

    [Fact]
    public void EnsureValid_PercentOver100_Throws()
    {
        Should.Throw<InvalidOperationException>(() =>
                DiscountedProductValidation.EnsureValid("Promo", null, null, [Item(null, 100.01m)]))
            .Message.ShouldBe("Percent discount must be less than or equal to 100.");
    }

    [Fact]
    public void EnsureValid_NoAddOns_IsAPlainProductRule()
    {
        List<CreateDiscountedProductItemRequestDto> items = [new(Guid.NewGuid(), 10m, null, [])];

        Should.NotThrow(() => DiscountedProductValidation.EnsureValid("Promo", null, null, items));
    }

    [Fact]
    public void EnsureValid_AddOnQuantityNotPositive_Throws()
    {
        Should.Throw<InvalidOperationException>(() =>
                DiscountedProductValidation.EnsureValid("Promo", null, null, [Item(addOnQuantity: 0)]))
            .Message.ShouldBe("Add-on quantity must be greater than zero.");
    }
}
