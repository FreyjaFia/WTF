using WTF.Calculations.Orders;
using WTF.Calculations.Sales;
using WTF.Domain.Entities;

namespace WTF.Tests.Calculations;

public class SeniorPwdReportRulesTests
{
    private static readonly IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), decimal> NoOverrides =
        new Dictionary<(Guid ProductId, Guid AddOnId), decimal>();

    private static Order OrderWithSeniorPwd(int statusId)
    {
        var product = new Product { Id = Guid.NewGuid(), Price = 100m };
        var order = new Order { Id = Guid.NewGuid(), StatusId = statusId };
        order.OrderItems.Add(new OrderItem
        {
            Id = Guid.NewGuid(),
            OrderId = order.Id,
            ProductId = product.Id,
            Product = product,
            Quantity = 1,
            Price = 100m,
            SeniorPwdVatExempt = 10.71m,
            SeniorPwdDiscount = 17.86m,
        });
        return order;
    }

    [Theory]
    [InlineData(OrderStatuses.Pending)]
    [InlineData(OrderStatuses.Completed)]
    [InlineData(OrderStatuses.Cancelled)]
    [InlineData(OrderStatuses.Refunded)]
    [InlineData(OrderStatuses.PendingApproval)]
    [InlineData(OrderStatuses.PendingReview)]
    public void IsCounted_AgreesWithWhatTheSalesSummaryCountsInItsSeniorPwdColumns(int statusId)
    {
        var summary = SalesRules.Summarize([OrderWithSeniorPwd(statusId)], NoOverrides);

        SeniorPwdReportRules.IsCounted(statusId).ShouldBe(summary.SeniorPwdDiscounts > 0m);
    }

    [Fact]
    public void CountedStatuses_AreExactlyTheOnesIsCountedAccepts()
    {
        var all = new[] { OrderStatuses.Pending, OrderStatuses.Completed, OrderStatuses.Cancelled, OrderStatuses.Refunded, OrderStatuses.PendingApproval, OrderStatuses.PendingReview };

        all.Where(SeniorPwdReportRules.IsCounted).ShouldBe(SeniorPwdReportRules.CountedStatuses, ignoreOrder: true);
    }

    [Fact]
    public void IsCounted_BuildsOnSalesRulesIsSale()
    {
        SalesRules.IsSale(OrderStatuses.Completed).ShouldBeTrue();
        SeniorPwdReportRules.IsCounted(OrderStatuses.Completed).ShouldBeTrue();
    }
}
