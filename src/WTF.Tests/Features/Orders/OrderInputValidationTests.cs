using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;

namespace WTF.Tests.Features.Orders;

public class OrderInputValidationTests
{
    private static OrderItemRequestDto Item(string? instructions = null, params OrderItemRequestDto[] addOns) =>
        new(Guid.NewGuid(), 1, [.. addOns], instructions, null);

    [Fact]
    public void EnsureLengths_TextAtTheLimits_IsAccepted()
    {
        Should.NotThrow(() => OrderInputValidation.EnsureLengths(
            new string('a', 100), new string('b', 500), [Item(new string('c', 100))], new string('d', 500)));
    }

    [Fact]
    public void EnsureLengths_NullAndEmptyValues_AreAccepted()
    {
        Should.NotThrow(() => OrderInputValidation.EnsureLengths(null, null, [Item()], null));
        Should.NotThrow(() => OrderInputValidation.EnsureLengths("", "", [], ""));
    }

    [Fact]
    public void EnsureLengths_SpecialInstructionsOverTheLimit_Throws()
    {
        var ex = Should.Throw<InvalidOperationException>(() =>
            OrderInputValidation.EnsureLengths(new string('a', 101), null, []));

        ex.Message.ShouldBe("Special instructions cannot be longer than 100 characters.");
    }

    [Fact]
    public void EnsureLengths_NoteOverTheLimit_Throws()
    {
        var ex = Should.Throw<InvalidOperationException>(() =>
            OrderInputValidation.EnsureLengths(null, new string('a', 501), []));

        ex.Message.ShouldBe("Note cannot be longer than 500 characters.");
    }

    [Fact]
    public void EnsureLengths_OverrideReasonOverTheLimit_Throws()
    {
        var ex = Should.Throw<InvalidOperationException>(() =>
            OrderInputValidation.EnsureLengths(null, null, [], new string('a', 501)));

        ex.Message.ShouldBe("Override reason cannot be longer than 500 characters.");
    }

    [Fact]
    public void EnsureLengths_ItemInstructionsOverTheLimit_Throws()
    {
        var ex = Should.Throw<InvalidOperationException>(() =>
            OrderInputValidation.EnsureLengths(null, null, [Item(new string('a', 101))]));

        ex.Message.ShouldBe("Item special instructions cannot be longer than 100 characters.");
    }

    [Fact]
    public void EnsureLengths_AddOnInstructionsOverTheLimit_Throws()
    {
        var addOn = Item(new string('a', 101));

        Should.Throw<InvalidOperationException>(() =>
            OrderInputValidation.EnsureLengths(null, null, [Item("ok", addOn)]));
    }

    [Fact]
    public void EnsureNoteLength_ChecksOnlyTheNote()
    {
        Should.NotThrow(() => OrderInputValidation.EnsureNoteLength(new string('a', 500)));
        Should.Throw<InvalidOperationException>(() => OrderInputValidation.EnsureNoteLength(new string('a', 501)));
        Should.NotThrow(() => OrderInputValidation.EnsureNoteLength(null));
    }
}
