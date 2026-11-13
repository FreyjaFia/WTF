namespace WTF.Calculations.Orders;

public sealed record OrderBreakdown(decimal Gross, decimal Discount, decimal SeniorPwdDiscount = 0m)
{
    public decimal Net => Gross - Discount - SeniorPwdDiscount;
}
