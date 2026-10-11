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
