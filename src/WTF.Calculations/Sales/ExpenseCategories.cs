namespace WTF.Calculations.Sales;

public static class ExpenseCategories
{
    public const byte Rent = 1;
    public const byte Salaries = 2;
    public const byte Utilities = 3;
    public const byte Supplies = 4;
    public const byte Marketing = 5;
    public const byte Delivery = 6;
    public const byte PaymentFees = 7;
    public const byte Other = 8;

    public static readonly IReadOnlyList<(byte Id, string Name)> All =
    [
        (Rent, "Rent"),
        (Salaries, "Salaries"),
        (Utilities, "Utilities"),
        (Supplies, "Supplies"),
        (Marketing, "Marketing"),
        (Delivery, "Delivery"),
        (PaymentFees, "Payment fees"),
        (Other, "Other")
    ];

    public static bool IsValid(byte id) => All.Any(category => category.Id == id);

    public static string NameOf(byte id) => All.FirstOrDefault(category => category.Id == id).Name ?? "Other";

    public static bool NeedsNote(byte id) => id == Other;
}
