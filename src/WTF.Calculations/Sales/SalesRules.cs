using WTF.Calculations.Orders;
using WTF.Domain.Entities;

namespace WTF.Calculations.Sales;

/// <summary>
/// The one definition of what counts as a sale. Every dashboard tile and report builds its numbers from here so the
/// same day cannot show two different revenues, averages or tip totals.
/// </summary>
public static class SalesRules
{
    /// <summary>Only a completed order sold anything: revenue, order count, average order value and tips all use these.</summary>
    public static bool IsSale(int statusId) => statusId == OrderStatuses.Completed;

    /// <summary>A cancelled order or a refunded sale. Voids are counted but never add to revenue.</summary>
    public static bool IsVoided(int statusId) =>
        statusId is OrderStatuses.Cancelled or OrderStatuses.Refunded;

    public static SalesSummary Summarize(
        IEnumerable<Order> orders,
        IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), decimal> addOnOverridePrices)
    {
        var total = 0;
        var completed = 0;
        var voided = 0;
        var revenue = 0m;
        var tips = 0m;

        foreach (var order in orders)
        {
            total++;
            if (IsVoided(order.StatusId))
            {
                voided++;
            }

            if (!IsSale(order.StatusId))
            {
                continue;
            }

            completed++;
            revenue += OrderMetrics.ComputeOrderTotal(order, addOnOverridePrices);
            tips += order.Tips ?? 0m;
        }

        return new SalesSummary(total, completed, voided, revenue, tips);
    }

    public static decimal Average(decimal amount, int count) => count > 0 ? amount / count : 0m;

    /// <summary>A share of the total as a percentage (0 to 100); 0 when there is no total to share.</summary>
    public static decimal PercentOfTotal(decimal part, decimal total) => total > 0 ? part / total * 100 : 0m;
}

/// <param name="TotalOrderCount">Every order in the set, whatever its status.</param>
/// <param name="CompletedOrderCount">Orders that sold something.</param>
/// <param name="VoidedOrderCount">Cancelled and refunded orders.</param>
/// <param name="Revenue">Completed orders only.</param>
/// <param name="Tips">Completed orders only.</param>
public sealed record SalesSummary(
    int TotalOrderCount,
    int CompletedOrderCount,
    int VoidedOrderCount,
    decimal Revenue,
    decimal Tips)
{
    public decimal AverageOrderValue => SalesRules.Average(Revenue, CompletedOrderCount);
}
