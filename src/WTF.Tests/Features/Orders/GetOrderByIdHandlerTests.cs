using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.Enums;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Orders;

public class GetOrderByIdHandlerTests
{
    private readonly OrderSeed _data = new(TestDb.NewName());

    private GetOrderByIdHandler Handler() => new(_data.Open());

    [Fact]
    public async Task Handle_UnknownId_ReturnsNull()
    {
        (await Handler().Handle(new GetOrderByIdQuery(Guid.NewGuid()), CancellationToken.None)).ShouldBeNull();
    }

    [Fact]
    public async Task Handle_ExistingOrder_ReturnsFullShape()
    {
        var burger = _data.AddProduct("Burger", 100);
        var cheese = _data.AddProduct("Cheese", 15, isAddOn: true);
        var customer = _data.AddCustomer("Ana", "Cruz");
        var orderId = _data.AddOrder(OrderStatusEnum.Completed, customer, paymentMethod: PaymentMethodEnum.Cash, note: "n");
        var parent = _data.AddLine(orderId, burger, 2, price: 90m, originalPrice: 100m, promoLabel: "10% off");
        _data.AddLine(orderId, cheese, 1, price: 10m, parentId: parent);
        await using (var db = _data.Open())
        {
            var o = await db.Orders.FindAsync(orderId);
            o!.OverrideReason = "fix";
            o.OverriddenAt = new DateTime(2026, 2, 3, 4, 5, 6, DateTimeKind.Utc);
            o.Tips = 5m;
            await db.SaveChangesAsync();
        }

        var dto = await Handler().Handle(new GetOrderByIdQuery(orderId), CancellationToken.None);

        dto!.Id.ShouldBe(orderId);
        dto.Status.ShouldBe(OrderStatusEnum.Completed);
        dto.PaymentMethod.ShouldBe(PaymentMethodEnum.Cash);
        dto.CustomerName.ShouldBe("Ana Cruz");
        dto.Note.ShouldBe("n");
        dto.Tips.ShouldBe(5m);
        dto.OverrideReason.ShouldBe("fix");
        dto.OverriddenAt.ShouldBe(new DateTime(2026, 2, 3, 4, 5, 6, DateTimeKind.Utc));
        dto.TotalAmount.ShouldBe(2 * (90m + 10m));
        var item = dto.Items.Single();
        item.OriginalPrice.ShouldBe(100m);
        item.PromoLabel.ShouldBe("10% off");
        item.AddOns.Single().ProductName.ShouldBe("Cheese");
        item.AddOns.Single().Price.ShouldBe(10m);
    }

    [Fact]
    public async Task Handle_PendingOrderWithoutSnapshot_UsesCurrentAndOverridePrices()
    {
        var burger = _data.AddProduct("Burger", 100);
        var cheese = _data.AddProduct("Cheese", 15, isAddOn: true);
        _data.AddAddOnPriceOverride(burger, cheese, 5m);
        var orderId = _data.AddOrder();
        var parent = _data.AddLine(orderId, burger, 1);
        _data.AddLine(orderId, cheese, 1, parentId: parent);

        var dto = await Handler().Handle(new GetOrderByIdQuery(orderId), CancellationToken.None);

        dto!.Items.Single().Price.ShouldBe(100m);
        dto.Items.Single().AddOns.Single().Price.ShouldBe(5m);
        dto.TotalAmount.ShouldBe(105m);
        dto.OverrideReason.ShouldBeNull();
        dto.OverriddenAt.ShouldBeNull();
        dto.CustomerName.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_OrderWithBundle_ReturnsBundleAndCountsItsPrice()
    {
        var burger = _data.AddProduct("Burger", 100);
        var promo = _data.AddFixedBundle("Combo", 150m);
        var orderId = _data.AddOrder();
        _data.AddLine(orderId, burger, 1, bundleId: promo);
        await using (var db = _data.Open())
        {
            db.OrderBundlePromotions.Add(new WTF.Domain.Entities.OrderBundlePromotion
            {
                Id = Guid.NewGuid(), OrderId = orderId, PromotionId = promo, Quantity = 2, UnitPrice = 150m,
            });
            await db.SaveChangesAsync();
        }

        var dto = await Handler().Handle(new GetOrderByIdQuery(orderId), CancellationToken.None);

        dto!.TotalAmount.ShouldBe(300m);
        dto.BundlePromotions!.Single().PromotionName.ShouldBe("Combo");
        dto.BundlePromotions!.Single().Quantity.ShouldBe(2);
    }

    [Fact]
    public async Task Handle_Items_AreOrderedBySortOrder()
    {
        var a = _data.AddProduct("A", 1);
        var b = _data.AddProduct("B", 2);
        var orderId = _data.AddOrder();
        _data.AddLine(orderId, b, 1, sortOrder: 1);
        _data.AddLine(orderId, a, 1, sortOrder: 0);

        var dto = await Handler().Handle(new GetOrderByIdQuery(orderId), CancellationToken.None);

        dto!.Items.Select(i => i.ProductName).ShouldBe(["A", "B"]);
    }
}
