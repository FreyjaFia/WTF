using WTF.Api.Features.Promotions;

namespace WTF.Tests.Features.Promotions;

public class FixedBundleValidationTests
{
    private static List<CreateFixedBundlePromotionItemRequestDto> ValidItems() =>
        [new(Guid.NewGuid(), 1, [new(Guid.NewGuid(), 1)])];

    [Fact]
    public void EnsureValid_ValidInput_DoesNotThrow()
    {
        Should.NotThrow(() => FixedBundleValidation.EnsureValid("Combo", null, null, ValidItems()));
    }

    [Theory]
    [InlineData("")]
    [InlineData("  ")]
    public void EnsureValid_BlankName_Throws(string name)
    {
        Should.Throw<InvalidOperationException>(() => FixedBundleValidation.EnsureValid(name, null, null, ValidItems()))
            .Message.ShouldBe("Promotion name is required.");
    }

    [Fact]
    public void EnsureValid_EndBeforeStart_Throws()
    {
        var start = new DateTime(2025, 2, 1);

        Should.Throw<InvalidOperationException>(() =>
                FixedBundleValidation.EnsureValid("Combo", start, start.AddDays(-1), ValidItems()))
            .Message.ShouldBe("End date cannot be earlier than start date.");
    }

    [Fact]
    public void EnsureValid_SameStartAndEnd_IsAllowed()
    {
        var day = new DateTime(2025, 2, 1);

        Should.NotThrow(() => FixedBundleValidation.EnsureValid("Combo", day, day, ValidItems()));
    }

    [Fact]
    public void EnsureValid_NoItems_Throws()
    {
        Should.Throw<InvalidOperationException>(() => FixedBundleValidation.EnsureValid("Combo", null, null, []))
            .Message.ShouldBe("At least one bundle item is required.");
    }

    [Fact]
    public void EnsureValid_ItemQuantityNotPositive_Throws()
    {
        List<CreateFixedBundlePromotionItemRequestDto> items = [new(Guid.NewGuid(), 0, [])];

        Should.Throw<InvalidOperationException>(() => FixedBundleValidation.EnsureValid("Combo", null, null, items))
            .Message.ShouldBe("Bundle item quantity must be greater than zero.");
    }

    [Fact]
    public void EnsureValid_AddOnQuantityNotPositive_Throws()
    {
        List<CreateFixedBundlePromotionItemRequestDto> items = [new(Guid.NewGuid(), 1, [new(Guid.NewGuid(), 0)])];

        Should.Throw<InvalidOperationException>(() => FixedBundleValidation.EnsureValid("Combo", null, null, items))
            .Message.ShouldBe("Bundle add-on quantity must be greater than zero.");
    }
}

public class MixMatchValidationTests
{
    private static CreateMixMatchPromotionCommand Valid() => new()
    {
        Name = "Mix",
        RequiredQuantity = 2,
        BundlePrice = 100m,
        Items = [new(Guid.NewGuid(), [])]
    };

    [Fact]
    public void EnsureValid_ValidCommand_DoesNotThrow()
    {
        Should.NotThrow(() => MixMatchValidation.EnsureValid(Valid()));
    }

    [Fact]
    public void EnsureValid_BlankName_Throws()
    {
        Should.Throw<InvalidOperationException>(() => MixMatchValidation.EnsureValid(Valid() with { Name = " " }))
            .Message.ShouldBe("Promotion name is required.");
    }

    [Fact]
    public void EnsureValid_EndBeforeStart_Throws()
    {
        var command = Valid() with { StartDate = new DateTime(2025, 5, 2), EndDate = new DateTime(2025, 5, 1) };

        Should.Throw<InvalidOperationException>(() => MixMatchValidation.EnsureValid(command))
            .Message.ShouldBe("End date cannot be earlier than start date.");
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void EnsureValid_RequiredQuantityNotPositive_Throws(int quantity)
    {
        Should.Throw<InvalidOperationException>(() => MixMatchValidation.EnsureValid(Valid() with { RequiredQuantity = quantity }))
            .Message.ShouldBe("Required quantity must be greater than zero.");
    }

    [Fact]
    public void EnsureValid_MaxSelectionsZero_Throws()
    {
        Should.Throw<InvalidOperationException>(() => MixMatchValidation.EnsureValid(Valid() with { MaxSelectionsPerOrder = 0 }))
            .Message.ShouldBe("Max selections per order must be greater than zero.");
    }

    [Fact]
    public void EnsureValid_MaxSelectionsNull_IsAllowed()
    {
        Should.NotThrow(() => MixMatchValidation.EnsureValid(Valid() with { MaxSelectionsPerOrder = null }));
    }

    [Fact]
    public void EnsureValid_NegativeBundlePrice_Throws()
    {
        Should.Throw<InvalidOperationException>(() => MixMatchValidation.EnsureValid(Valid() with { BundlePrice = -1m }))
            .Message.ShouldBe("Bundle price must be greater than or equal to zero.");
    }

    [Fact]
    public void EnsureValid_ZeroBundlePrice_IsAllowed()
    {
        Should.NotThrow(() => MixMatchValidation.EnsureValid(Valid() with { BundlePrice = 0m }));
    }

    [Fact]
    public void EnsureValid_NoItems_Throws()
    {
        Should.Throw<InvalidOperationException>(() => MixMatchValidation.EnsureValid(Valid() with { Items = [] }))
            .Message.ShouldBe("At least one product is required.");
    }

    [Fact]
    public void EnsureValid_DuplicateProducts_Throws()
    {
        var id = Guid.NewGuid();

        Should.Throw<InvalidOperationException>(() =>
                MixMatchValidation.EnsureValid(Valid() with { Items = [new(id, []), new(id, [])] }))
            .Message.ShouldBe("Duplicate products are not allowed.");
    }

    [Fact]
    public void EnsureValid_AddOnQuantityNotPositive_Throws()
    {
        var command = Valid() with { Items = [new(Guid.NewGuid(), [new(Guid.NewGuid(), 0)])] };

        Should.Throw<InvalidOperationException>(() => MixMatchValidation.EnsureValid(command))
            .Message.ShouldBe("Add-on quantity must be greater than zero.");
    }

    [Fact]
    public void EnsureValid_UpdateCommand_AppliesSameRules()
    {
        var update = new UpdateMixMatchPromotionCommand
        {
            PromotionId = Guid.NewGuid(),
            Name = "Mix",
            RequiredQuantity = 0,
            Items = [new(Guid.NewGuid(), [])]
        };

        Should.Throw<InvalidOperationException>(() => MixMatchValidation.EnsureValid(update))
            .Message.ShouldBe("Required quantity must be greater than zero.");
    }
}

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
            .Message.ShouldBe("Each discounted product must have a fixed price or percent discount.");
    }

    [Fact]
    public void EnsureValid_ZeroValuesCountAsMissing_Throws()
    {
        Should.Throw<InvalidOperationException>(() =>
                DiscountedProductValidation.EnsureValid("Promo", null, null, [Item(0m, 0m)]))
            .Message.ShouldBe("Each discounted product must have a fixed price or percent discount.");
    }

    [Fact]
    public void EnsureValid_BothFixedAndPercent_Throws()
    {
        Should.Throw<InvalidOperationException>(() =>
                DiscountedProductValidation.EnsureValid("Promo", null, null, [Item(10m, 10m)]))
            .Message.ShouldBe("Choose either a fixed price or percent discount, not both.");
    }

    [Fact]
    public void EnsureValid_PercentOver100_Throws()
    {
        Should.Throw<InvalidOperationException>(() =>
                DiscountedProductValidation.EnsureValid("Promo", null, null, [Item(null, 100.01m)]))
            .Message.ShouldBe("Percent discount must be less than or equal to 100.");
    }

    [Fact]
    public void EnsureValid_NoAddOns_Throws()
    {
        List<CreateDiscountedProductItemRequestDto> items = [new(Guid.NewGuid(), 10m, null, [])];

        Should.Throw<InvalidOperationException>(() => DiscountedProductValidation.EnsureValid("Promo", null, null, items))
            .Message.ShouldBe("Select at least one required add-on for each discounted product.");
    }

    [Fact]
    public void EnsureValid_AddOnQuantityNotPositive_Throws()
    {
        Should.Throw<InvalidOperationException>(() =>
                DiscountedProductValidation.EnsureValid("Promo", null, null, [Item(addOnQuantity: 0)]))
            .Message.ShouldBe("Add-on quantity must be greater than zero.");
    }
}
