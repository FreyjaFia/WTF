using WTF.Api.Features.Orders.DTOs;

namespace WTF.Api.Features.Orders;

/// <summary>Text limits that match the Orders and OrderItems columns, so over-long input is a clear error.</summary>
internal static class OrderInputValidation
{
    public const int InstructionsMaxLength = 100;
    public const int NoteMaxLength = 500;

    public static void EnsureLengths(
        string? specialInstructions,
        string? note,
        IEnumerable<OrderItemRequestDto> items,
        string? overrideReason = null)
    {
        EnsureMax(specialInstructions, InstructionsMaxLength, "Special instructions");
        EnsureMax(note, NoteMaxLength, "Note");
        EnsureMax(overrideReason, NoteMaxLength, "Override reason");

        foreach (var item in items)
        {
            EnsureItemLengths(item);
        }
    }

    public static void EnsureNoteLength(string? note) => EnsureMax(note, NoteMaxLength, "Note");

    private static void EnsureItemLengths(OrderItemRequestDto item)
    {
        EnsureMax(item.SpecialInstructions, InstructionsMaxLength, "Item special instructions");

        foreach (var addOn in item.AddOns ?? [])
        {
            EnsureItemLengths(addOn);
        }
    }

    private static void EnsureMax(string? value, int maxLength, string label)
    {
        if (value is not null && value.Length > maxLength)
        {
            throw new InvalidOperationException($"{label} cannot be longer than {maxLength} characters.");
        }
    }
}
