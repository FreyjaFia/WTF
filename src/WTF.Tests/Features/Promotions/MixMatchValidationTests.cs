using WTF.Api.Features.Promotions;

namespace WTF.Tests.Features.Promotions;

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
