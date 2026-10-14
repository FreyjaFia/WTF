namespace WTF.Calculations.Orders;

public sealed record OrderBreakdown(decimal Gross, decimal Discount)
{
    public decimal Net => Gross - Discount;
}
