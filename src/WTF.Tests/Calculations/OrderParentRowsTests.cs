using WTF.Calculations.Orders;
using WTF.Domain.Entities;

namespace WTF.Tests.Calculations;

public class OrderParentRowsTests
{
    [Fact]
    public void ParentRows_SkipsAddOnsAndBundleLines()
    {
        var parent = new OrderItem { Id = Guid.NewGuid() };
        var order = new Order
        {
            OrderItems =
            [
                parent,
                new OrderItem { Id = Guid.NewGuid(), ParentOrderItemId = parent.Id },
                new OrderItem { Id = Guid.NewGuid(), BundlePromotionId = Guid.NewGuid() },
            ],
        };

        OrderMetrics.ParentRows(order).ShouldHaveSingleItem().ShouldBeSameAs(parent);
    }

    [Fact]
    public void SalesSummary_GrossSalesAddsTheWholeSeniorPwdReduction()
    {
        var summary = new WTF.Calculations.Sales.SalesSummary(1, 1, 0, 80m, 0m, SeniorPwdDiscounts: 10m, VatExemptSales: 5m);

        summary.GrossSales.ShouldBe(95m);
    }
}
