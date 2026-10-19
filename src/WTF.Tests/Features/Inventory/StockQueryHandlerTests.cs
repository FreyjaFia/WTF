using WTF.Api.Common.Auth;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Items;
using WTF.Api.Features.Orders.Enums;
using WTF.Tests.Features.Items;
using WTF.Tests.Features.Orders;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class StockQueryHandlerTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();

    [Fact]
    public async Task ItemMovements_UnknownItem_ReturnsNull() =>
        (await new GetItemMovementsHandler(TestDb.Create(_db)).Handle(new GetItemMovementsQuery(Guid.NewGuid()), CancellationToken.None))
            .ShouldBeNull();

    [Fact]
    public async Task ItemMovements_ArePagedNewestFirst_FilterByType_AndCarryTheOrderNumber()
    {
        await ItemSeed.User(_db, _userId);
        var data = new OrderSeed(_db);
        var milk = StockSeed.Item(_db, "Milk", 5000m);
        var latte = data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, latte, milk, 200m);

        var create = new WTF.Api.Features.Orders.CreateOrderHandler(
            TestDb.Create(_db), TestRequest.As(_userId, AppRoles.Admin), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(),
            TestFakes.Conversations(), TestFakes.Stock(TestDb.Create(_db)));
        var order = await create.Handle(new WTF.Api.Features.Orders.CreateOrderCommand
        {
            Status = OrderStatusEnum.Completed,
            Items = [new(latte, 2, [], null, null)]
        }, CancellationToken.None);
        await new AddItemStockHandler(TestDb.Create(_db), TestRequest.As(_userId), TestFakes.Audit())
            .Handle(new AddItemStockCommand { ItemId = milk, Quantity = 100m }, CancellationToken.None);

        var handler = new GetItemMovementsHandler(TestDb.Create(_db));
        var all = (await handler.Handle(new GetItemMovementsQuery(milk), CancellationToken.None))!;
        var sales = (await handler.Handle(new GetItemMovementsQuery(milk, "Sale"), CancellationToken.None))!;
        var firstPage = (await handler.Handle(new GetItemMovementsQuery(milk, PageSize: 1), CancellationToken.None))!;

        all.TotalCount.ShouldBe(2);
        all.Items[0].MovementType.ShouldBe("AddStock");
        sales.Items.Single().OrderNumber.ShouldBe(order.OrderNumber);
        sales.Items.Single().ProductName.ShouldBe("Latte");
        firstPage.Items.Count.ShouldBe(1);
        firstPage.TotalCount.ShouldBe(2);
    }

    [Fact]
    public async Task OrderMovements_UnknownOrder_ReturnsNull() =>
        (await new GetOrderStockMovementsHandler(TestDb.Create(_db)).Handle(new GetOrderStockMovementsQuery(Guid.NewGuid()), CancellationToken.None))
            .ShouldBeNull();

    [Fact]
    public async Task OrderMovements_ListsWhatTheOrderCaused()
    {
        var data = new OrderSeed(_db);
        var milk = StockSeed.Item(_db, "Milk", 5000m);
        var latte = data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, latte, milk, 200m);
        var order = data.AddOrder(OrderStatusEnum.Completed);
        data.AddLine(order, latte, 2);
        await TestFakes.Stock(TestDb.Create(_db)).DeductForOrderAsync(order, _userId, new StockDeductionOptions(), CancellationToken.None);

        var movements = (await new GetOrderStockMovementsHandler(TestDb.Create(_db))
            .Handle(new GetOrderStockMovementsQuery(order), CancellationToken.None))!;

        var row = movements.Single();
        row.ItemName.ShouldBe("Milk");
        row.ProductName.ShouldBe("Latte");
        row.QuantityDelta.ShouldBe(-400m);
        row.QuantityAfter.ShouldBe(4600m);
    }

    [Fact]
    public async Task CreateItem_KeepsTheNegativeStockSwitch()
    {
        await ItemSeed.User(_db, _userId);
        var handler = new CreateItemHandler(TestDb.Create(_db), TestRequest.As(_userId), TestFakes.Audit());

        var strict = await handler.Handle(new CreateItemCommand { Name = "Strict", AllowNegativeStock = false }, CancellationToken.None);
        var loose = await handler.Handle(new CreateItemCommand { Name = "Loose" }, CancellationToken.None);

        strict.AllowNegativeStock.ShouldBeFalse();
        loose.AllowNegativeStock.ShouldBeTrue();
    }

    [Fact]
    public async Task UpdateItem_RefusesBlockingWhileTheBalanceIsNegative()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, qty: -3m);
        var handler = new UpdateItemHandler(TestDb.Create(_db), TestRequest.As(_userId), TestFakes.Audit());

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => handler.Handle(
            new UpdateItemCommand { Id = item.Id, Name = "Flour", UnitName = "kg", AllowNegativeStock = false }, CancellationToken.None));

        ex.Message.ShouldContain("below zero");
    }
}
