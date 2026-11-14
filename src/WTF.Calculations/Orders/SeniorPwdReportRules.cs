using WTF.Calculations.Sales;

namespace WTF.Calculations.Orders;

public static class SeniorPwdReportRules
{
    // Sold and refunded orders: the same orders SalesRules.Summarize counts in its Senior/PWD columns, so the report
    // total reconciles with them. A refunded order stays in the list, marked as refunded, because its discount was given.
    public static readonly int[] CountedStatuses = [OrderStatuses.Completed, OrderStatuses.Refunded];

    public static bool IsCounted(int statusId) => SalesRules.IsSale(statusId) || statusId == OrderStatuses.Refunded;

    public static bool IsRefunded(int statusId) => statusId == OrderStatuses.Refunded;

    public static decimal NetAmount(decimal covered, decimal vatExempt, decimal discount) => covered - vatExempt - discount;
}
