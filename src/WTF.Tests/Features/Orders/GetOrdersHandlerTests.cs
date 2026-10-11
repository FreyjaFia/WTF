using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.Enums;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Orders;

public class GetOrdersHandlerTests
{
    private readonly OrderSeed _data = new(TestDb.NewName());

    private GetOrdersHandler Handler() => new(_data.Open());

    [Fact]
    public async Task Handle_NoOrders_ReturnsEmptyList()
    {
        (await Handler().Handle(new GetOrdersQuery(), CancellationToken.None)).ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_AllStatuses_ReturnsNewestFirst()
    {
        var now = DateTime.UtcNow;
        var old = _data.AddOrder(createdAt: now.AddHours(-3));
        var mid = _data.AddOrder(OrderStatusEnum.Completed, createdAt: now.AddHours(-2));
        var recent = _data.AddOrder(OrderStatusEnum.Cancelled, createdAt: now.AddHours(-1));

        var result = await Handler().Handle(new GetOrdersQuery(), CancellationToken.None);

        result.Select(o => o.Id).ShouldBe([recent, mid, old]);
    }

    [Fact]
    public async Task Handle_StatusFilter_ReturnsOnlyThatStatus()
    {
        _data.AddOrder();
        var completed = _data.AddOrder(OrderStatusEnum.Completed);
        _data.AddOrder(OrderStatusEnum.Refunded);

        var result = await Handler().Handle(new GetOrdersQuery(OrderStatusEnum.Completed), CancellationToken.None);

        result.Single().Id.ShouldBe(completed);
    }

    [Fact]
    public async Task Handle_ExcludeFinalized_HidesCompletedAndRefundedButKeepsCancelled()
    {
        var pending = _data.AddOrder();
        _data.AddOrder(OrderStatusEnum.Completed);
        _data.AddOrder(OrderStatusEnum.Refunded);
        var cancelled = _data.AddOrder(OrderStatusEnum.Cancelled);

        var result = await Handler().Handle(new GetOrdersQuery(ExcludeFinalized: true), CancellationToken.None);

        result.Select(o => o.Id).ShouldBe([pending, cancelled], ignoreOrder: true);
    }

    [Fact]
    public async Task Handle_ExplicitStatusWithExcludeFinalized_StatusWins()
    {
        var completed = _data.AddOrder(OrderStatusEnum.Completed);
        _data.AddOrder();

        var result = await Handler().Handle(
            new GetOrdersQuery(OrderStatusEnum.Completed, ExcludeFinalized: true), CancellationToken.None);

        result.Single().Id.ShouldBe(completed);
    }

    [Fact]
    public async Task Handle_CustomerFilter_ReturnsOnlyThatCustomersOrders()
    {
        var ana = _data.AddCustomer("Ana", "Cruz");
        var ben = _data.AddCustomer("Ben", "Lim");
        var anaOrder = _data.AddOrder(customerId: ana);
        _data.AddOrder(customerId: ben);
        _data.AddOrder();

        var result = await Handler().Handle(new GetOrdersQuery(CustomerId: ana), CancellationToken.None);

        result.Single().Id.ShouldBe(anaOrder);
        result.Single().CustomerName.ShouldBe("Ana Cruz");
    }

    [Fact]
    public async Task Handle_OrderDto_IncludesOverrideInfoItemsAndTotals()
    {
        var burger = _data.AddProduct("Burger", 100);
        var cheese = _data.AddProduct("Cheese", 15, isAddOn: true);
        var orderId = _data.AddOrder(OrderStatusEnum.Completed);
        var parent = _data.AddLine(orderId, burger, 2, price: 90m);
        _data.AddLine(orderId, cheese, 1, price: 10m, parentId: parent);
        await using (var db = _data.Open())
        {
            var o = await db.Orders.FindAsync(orderId);
            o!.OverrideReason = "fix";
            o.OverriddenAt = new DateTime(2026, 5, 6, 7, 8, 9, DateTimeKind.Utc);
            await db.SaveChangesAsync();
        }

        var dto = (await Handler().Handle(new GetOrdersQuery(), CancellationToken.None)).Single();

        dto.OverrideReason.ShouldBe("fix");
        dto.OverriddenAt.ShouldBe(new DateTime(2026, 5, 6, 7, 8, 9, DateTimeKind.Utc));
        dto.TotalAmount.ShouldBe(200m);
        dto.Items.Single().AddOns.Single().Price.ShouldBe(10m);
    }

    [Fact]
    public async Task Handle_PendingAddOnWithoutSnapshot_UsesActiveOverrideNotInactiveOne()
    {
        var burger = _data.AddProduct("Burger", 100);
        var cheese = _data.AddProduct("Cheese", 15, isAddOn: true);
        var bacon = _data.AddProduct("Bacon", 20, isAddOn: true);
        _data.AddAddOnPriceOverride(burger, cheese, 5m);
        _data.AddAddOnPriceOverride(burger, bacon, 1m, isActive: false);
        var orderId = _data.AddOrder();
        var parent = _data.AddLine(orderId, burger, 1);
        _data.AddLine(orderId, cheese, 1, parentId: parent);
        _data.AddLine(orderId, bacon, 1, parentId: parent, sortOrder: 1);

        var dto = (await Handler().Handle(new GetOrdersQuery(), CancellationToken.None)).Single();

        dto.Items.Single().AddOns.Select(a => a.Price).ShouldBe([5m, 20m]);
        dto.TotalAmount.ShouldBe(125m);
    }
}
