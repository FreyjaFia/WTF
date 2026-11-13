using WTF.Calculations.Sales;
using WTF.Domain.Entities;

namespace WTF.Tests.Calculations;

public class SalesRulesSeniorPwdTests
{
    private static readonly IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), decimal> NoOverrides =
        new Dictionary<(Guid ProductId, Guid AddOnId), decimal>();

    private static Order OrderWithSeniorPwd(int statusId, decimal vatExempt, decimal discount)
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
            SeniorPwdVatExempt = vatExempt,
            SeniorPwdDiscount = discount,
        });
        return order;
    }

    [Fact]
    public void Summarize_CompletedOrder_CountsTheDiscountAndKeepsGrossAtTheListPrice()
    {
        var summary = SalesRules.Summarize([OrderWithSeniorPwd(OrderStatuses.Completed, 10.71m, 17.86m)], NoOverrides);

        summary.Revenue.ShouldBe(71.43m);
        summary.SeniorPwdDiscounts.ShouldBe(17.86m);
        summary.VatExemptSales.ShouldBe(10.71m);
        summary.GrossSales.ShouldBe(100m);
        summary.NetSales.ShouldBe(71.43m);
    }

    [Fact]
    public void Summarize_RefundedOrder_StaysInGrossAndIsTakenOffAsARefund()
    {
        var summary = SalesRules.Summarize([OrderWithSeniorPwd(OrderStatuses.Refunded, 0m, 20m)], NoOverrides);

        summary.Revenue.ShouldBe(0m);
        summary.RefundedAmount.ShouldBe(80m);
        summary.SeniorPwdDiscounts.ShouldBe(20m);
        summary.GrossSales.ShouldBe(100m);
    }

    [Fact]
    public void Summarize_CancelledOrder_NeverCounts()
    {
        var summary = SalesRules.Summarize([OrderWithSeniorPwd(OrderStatuses.Cancelled, 0m, 20m)], NoOverrides);

        summary.SeniorPwdDiscounts.ShouldBe(0m);
        summary.VatExemptSales.ShouldBe(0m);
        summary.Revenue.ShouldBe(0m);
    }

    [Fact]
    public void Summarize_OrderWithoutTheDiscount_HasNone()
    {
        var order = OrderWithSeniorPwd(OrderStatuses.Completed, 0m, 0m);

        var summary = SalesRules.Summarize([order], NoOverrides);

        summary.SeniorPwdDiscounts.ShouldBe(0m);
        summary.GrossSales.ShouldBe(100m);
    }
}
