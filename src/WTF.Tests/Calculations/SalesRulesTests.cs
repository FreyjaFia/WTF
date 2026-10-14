using WTF.Api.Features.Orders.Enums;
using WTF.Calculations.Sales;
using WTF.Domain.Entities;

namespace WTF.Tests.Calculations;

public class SalesRulesTests
{
    private static readonly IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), decimal> NoOverrides =
        new Dictionary<(Guid ProductId, Guid AddOnId), decimal>();

    private static Order OrderOf(int statusId, decimal amount, decimal? tips = null)
    {
        var product = new Product { Id = Guid.NewGuid(), Price = amount };
        var order = new Order { Id = Guid.NewGuid(), StatusId = statusId, Tips = tips };
        order.OrderItems.Add(new OrderItem
        {
            Id = Guid.NewGuid(),
            OrderId = order.Id,
            ProductId = product.Id,
            Product = product,
            Quantity = 1,
            Price = amount,
        });
        return order;
    }

    [Theory]
    [InlineData(OrderStatuses.Completed, true)]
    [InlineData(OrderStatuses.Pending, false)]
    [InlineData(OrderStatuses.Cancelled, false)]
    [InlineData(OrderStatuses.Refunded, false)]
    [InlineData(OrderStatuses.PendingApproval, false)]
    public void IsSale_OnlyCompletedOrdersSold(int statusId, bool expected) =>
        SalesRules.IsSale(statusId).ShouldBe(expected);

    [Theory]
    [InlineData(OrderStatuses.Cancelled, true)]
    [InlineData(OrderStatuses.Refunded, true)]
    [InlineData(OrderStatuses.Completed, false)]
    [InlineData(OrderStatuses.Pending, false)]
    [InlineData(OrderStatuses.PendingApproval, false)]
    public void IsVoided_CancelledAndRefundedOnly(int statusId, bool expected) =>
        SalesRules.IsVoided(statusId).ShouldBe(expected);

    [Fact]
    public void StatusIds_MatchTheApiEnum()
    {
        OrderStatuses.Pending.ShouldBe((int)OrderStatusEnum.Pending);
        OrderStatuses.Completed.ShouldBe((int)OrderStatusEnum.Completed);
        OrderStatuses.Cancelled.ShouldBe((int)OrderStatusEnum.Cancelled);
        OrderStatuses.Refunded.ShouldBe((int)OrderStatusEnum.Refunded);
        OrderStatuses.PendingApproval.ShouldBe((int)OrderStatusEnum.PendingApproval);
    }

    [Fact]
    public void Summarize_NoOrders_IsAllZero()
    {
        var summary = SalesRules.Summarize([], NoOverrides);

        summary.TotalOrderCount.ShouldBe(0);
        summary.CompletedOrderCount.ShouldBe(0);
        summary.VoidedOrderCount.ShouldBe(0);
        summary.Revenue.ShouldBe(0m);
        summary.Tips.ShouldBe(0m);
        summary.AverageOrderValue.ShouldBe(0m);
    }

    [Fact]
    public void Summarize_MixedStatuses_RevenueAverageAndTipsUseCompletedOrdersOnly()
    {
        var orders = new[]
        {
            OrderOf(OrderStatuses.Completed, 100m, tips: 5m),
            OrderOf(OrderStatuses.Completed, 200m, tips: 15m),
            OrderOf(OrderStatuses.Cancelled, 900m, tips: 99m),
            OrderOf(OrderStatuses.Refunded, 900m, tips: 99m),
            OrderOf(OrderStatuses.Pending, 900m, tips: 99m),
            OrderOf(OrderStatuses.PendingApproval, 900m, tips: 99m),
        };

        var summary = SalesRules.Summarize(orders, NoOverrides);

        summary.TotalOrderCount.ShouldBe(6);
        summary.CompletedOrderCount.ShouldBe(2);
        summary.VoidedOrderCount.ShouldBe(2);
        summary.Revenue.ShouldBe(300m);
        summary.Tips.ShouldBe(20m);
        summary.AverageOrderValue.ShouldBe(150m);
    }

    [Fact]
    public void Summarize_OnlyVoidedOrders_HasNoRevenueAndAZeroAverage()
    {
        var summary = SalesRules.Summarize([OrderOf(OrderStatuses.Cancelled, 50m)], NoOverrides);

        summary.Revenue.ShouldBe(0m);
        summary.AverageOrderValue.ShouldBe(0m);
        summary.VoidedOrderCount.ShouldBe(1);
    }

    [Theory]
    [InlineData(25, 100, 25)]
    [InlineData(0, 100, 0)]
    [InlineData(100, 100, 100)]
    [InlineData(10, 0, 0)]
    public void PercentOfTotal_IsZeroWhenThereIsNothingToShare(double part, double total, double expected) =>
        SalesRules.PercentOfTotal((decimal)part, (decimal)total).ShouldBe((decimal)expected);

    [Fact]
    public void Average_DividesByTheCountAndGuardsZero()
    {
        SalesRules.Average(300m, 3).ShouldBe(100m);
        SalesRules.Average(300m, 0).ShouldBe(0m);
    }
}
