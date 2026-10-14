namespace WTF.Calculations.Sales;

/// <summary>
/// The cash side of a sale, as it works at the counter: a tip is part of what the customer hands over, so the cashier
/// gives back the cash minus the total and the tip. The POS and the customer link both follow this rule.
/// </summary>
public static class CashPayment
{
    /// <summary>What the customer has to pay in cash: the order total plus any tip.</summary>
    public static decimal AmountDue(decimal total, decimal? tips) => total + (tips ?? 0m);

    /// <summary>Cash handed over minus what is due. Negative when the cash does not cover it.</summary>
    public static decimal Change(decimal received, decimal total, decimal? tips) => received - AmountDue(total, tips);

    /// <summary>The change the cashier gives back; 0 when the cash falls short.</summary>
    public static decimal ChangeToGive(decimal received, decimal total, decimal? tips) =>
        Math.Max(0m, Change(received, total, tips));
}
