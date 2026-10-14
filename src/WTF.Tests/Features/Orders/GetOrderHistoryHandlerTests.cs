using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.Enums;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Orders;

public class GetOrderHistoryHandlerTests
{
    private readonly OrderSeed _data = new(TestDb.NewName());

    private GetOrderHistoryHandler Handler() => new(_data.Open());

    [Fact]
    public async Task Handle_NoOrders_ReturnsEmpty()
    {
        (await Handler().Handle(new GetOrderHistoryQuery(), CancellationToken.None)).ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_OnlyCompletedAndRefunded_NewestFirst()
    {
        var now = DateTime.UtcNow;
        _data.AddOrder(createdAt: now);
        _data.AddOrder(OrderStatusEnum.Cancelled, createdAt: now);
        var older = _data.AddOrder(OrderStatusEnum.Completed, createdAt: now.AddHours(-2));
        var newer = _data.AddOrder(OrderStatusEnum.Refunded, createdAt: now.AddHours(-1));

        var result = await Handler().Handle(new GetOrderHistoryQuery(), CancellationToken.None);

        result.Select(o => o.Id).ShouldBe([newer, older]);
        result.Select(o => o.Status).ShouldBe([OrderStatusEnum.Refunded, OrderStatusEnum.Completed]);
    }

    [Fact]
    public async Task Handle_CustomerFilter_ReturnsOnlyThatCustomersHistory()
    {
        var ana = _data.AddCustomer("Ana", "Cruz");
        var ben = _data.AddCustomer("Ben", "Lim");
        var mine = _data.AddOrder(OrderStatusEnum.Completed, ana);
        _data.AddOrder(OrderStatusEnum.Completed, ben);
        _data.AddOrder(OrderStatusEnum.Pending, ana);

        var result = await Handler().Handle(new GetOrderHistoryQuery(ana), CancellationToken.None);

        result.Single().Id.ShouldBe(mine);
        result.Single().CustomerName.ShouldBe("Ana Cruz");
    }

    [Fact]
    public async Task Handle_Totals_IncludeAddOnsQuantitiesAndBundles()
    {
        var burger = _data.AddProduct("Burger", 100);
        var cheese = _data.AddProduct("Cheese", 15, isAddOn: true);
        var promo = _data.AddFixedBundle("Combo", 150m);
        var orderId = _data.AddOrder(OrderStatusEnum.Completed, paymentMethod: PaymentMethodEnum.GCash, note: "ok");
        var parent = _data.AddLine(orderId, burger, 2, price: 90m);
        _data.AddLine(orderId, cheese, 2, price: 10m, parentId: parent);
        await using (var db = _data.Open())
        {
            db.OrderBundlePromotions.Add(new WTF.Domain.Entities.OrderBundlePromotion
            {
                Id = Guid.NewGuid(),
                OrderId = orderId,
                PromotionId = promo,
                Quantity = 1,
                UnitPrice = 150m,
            });
            await db.SaveChangesAsync();
        }

        var dto = (await Handler().Handle(new GetOrderHistoryQuery(), CancellationToken.None)).Single();

        dto.TotalAmount.ShouldBe(2 * (90m + 2 * 10m) + 150m);
        dto.PaymentMethod.ShouldBe(PaymentMethodEnum.GCash);
        dto.Note.ShouldBe("ok");
        dto.CustomerName.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_AddOnWithoutSnapshot_UsesActiveOverridePrice()
    {
        var burger = _data.AddProduct("Burger", 100);
        var cheese = _data.AddProduct("Cheese", 15, isAddOn: true);
        _data.AddAddOnPriceOverride(burger, cheese, 5m);
        var orderId = _data.AddOrder(OrderStatusEnum.Completed);
        var parent = _data.AddLine(orderId, burger, 1, price: 100m);
        _data.AddLine(orderId, cheese, 1, parentId: parent);

        var dto = (await Handler().Handle(new GetOrderHistoryQuery(), CancellationToken.None)).Single();

        dto.TotalAmount.ShouldBe(105m);
    }
}
