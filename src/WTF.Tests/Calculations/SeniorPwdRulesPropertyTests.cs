using System.Numerics;
using WTF.Calculations.Orders;
using WTF.Domain.Entities;

namespace WTF.Tests.Calculations;

public class SeniorPwdRulesPropertyTests
{
    private static readonly IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), decimal> NoOverrides =
        new Dictionary<(Guid ProductId, Guid AddOnId), decimal>();

    // Round half up of numerator / denominator with whole numbers, so it does not depend on decimal arithmetic.
    private static long RoundDiv(BigInteger numerator, BigInteger denominator) => (long)((2 * numerator + denominator) / (2 * denominator));

    private static (long VatExempt, long Discount) Oracle(long coveredCents, bool vatRegistered)
    {
        if (!vatRegistered)
        {
            return (0, RoundDiv(coveredCents, 5));
        }

        var net = RoundDiv(coveredCents * 100, 112);
        return (coveredCents - net, RoundDiv(net, 5));
    }

    [Fact]
    public void ForRow_MatchesAnIndependentIntegerOracle_ForEveryCentUpToTenThousandPesos()
    {
        for (var cents = 1L; cents <= 1_000_000; cents++)
        {
            foreach (var vat in new[] { false, true })
            {
                var amounts = SeniorPwdRules.ForRow(cents / 100m, vat);
                var (vatExempt, discount) = Oracle(cents, vat);

                amounts.VatExempt.ShouldBe(vatExempt / 100m, $"{cents} cents, vat {vat}");
                amounts.Discount.ShouldBe(discount / 100m, $"{cents} cents, vat {vat}");
                amounts.AmountDue.ShouldBeGreaterThanOrEqualTo(0m);
            }
        }
    }

    [Fact]
    public void RandomOrders_RowsPersonsAndOrderTotalAlwaysAddUp()
    {
        var random = new Random(20261113);
        for (var round = 0; round < 500; round++)
        {
            var vat = random.Next(2) == 0;
            var order = new Order { Id = Guid.NewGuid() };
            var personCount = random.Next(1, 4);
            var personTotals = new decimal[personCount];
            var listTotal = 0m;
            var reduction = 0m;

            for (var line = 0; line < random.Next(1, 7); line++)
            {
                var product = new Product { Id = Guid.NewGuid(), Price = random.Next(1, 50_001) / 100m };
                var parent = new OrderItem
                {
                    Id = Guid.NewGuid(),
                    OrderId = order.Id,
                    ProductId = product.Id,
                    Product = product,
                    Quantity = random.Next(1, 10),
                    Price = product.Price,
                };
                order.OrderItems.Add(parent);

                var children = new List<OrderItem>();
                for (var addOn = 0; addOn < random.Next(0, 3); addOn++)
                {
                    var addOnProduct = new Product { Id = Guid.NewGuid(), Price = random.Next(0, 5_001) / 100m };
                    var child = new OrderItem
                    {
                        Id = Guid.NewGuid(),
                        OrderId = order.Id,
                        ProductId = addOnProduct.Id,
                        Product = addOnProduct,
                        Quantity = random.Next(1, 4),
                        Price = addOnProduct.Price,
                        ParentOrderItemId = parent.Id,
                    };
                    order.OrderItems.Add(child);
                    children.Add(child);
                }

                var rowTotal = OrderMetrics.ComputeParentItemTotal(parent, children, NoOverrides);
                listTotal += rowTotal;
                if (random.Next(2) == 0)
                {
                    continue;
                }

                var amounts = SeniorPwdRules.ForRow(rowTotal, vat);
                parent.SeniorPwdVatExempt = amounts.VatExempt;
                parent.SeniorPwdDiscount = amounts.Discount;
                reduction += amounts.Reduction;
                personTotals[random.Next(personCount)] += amounts.Reduction;
                amounts.Covered.ShouldBe(rowTotal);
                (amounts.Covered - amounts.VatExempt - amounts.Discount).ShouldBe(amounts.AmountDue);
            }

            OrderMetrics.ComputeOrderTotal(order, NoOverrides).ShouldBe(listTotal - reduction, $"round {round}");
            personTotals.Sum().ShouldBe(reduction);
            OrderMetrics.ComputeOrderBreakdown(order, NoOverrides).Net.ShouldBe(listTotal - reduction);
        }
    }
}
