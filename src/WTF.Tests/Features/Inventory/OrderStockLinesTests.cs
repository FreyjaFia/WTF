using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.Enums;
using WTF.Tests.Features.Orders;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class OrderStockLinesTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();
    private readonly OrderSeed _data;
    private readonly Guid _milk;
    private readonly Guid _latte;
    private readonly Guid _water;
    private readonly Guid _oat;

    public OrderStockLinesTests()
    {
        _data = new OrderSeed(_db);
        _milk = StockSeed.Item(_db, "Oat Milk", 10000m);
        _latte = _data.AddProduct("Latte", 150m);
        _water = _data.AddProduct("Water", 20m);
        _oat = _data.AddProduct("Oat", 30m, isAddOn: true);
        StockSeed.Link(_db, _latte, _milk, 200m);
        StockSeed.Link(_db, _oat, _milk, 100m);
    }

    private async Task<List<Guid>?> StockLineIds(Guid orderId)
    {
        var dto = await new GetOrderByIdHandler(TestDb.Create(_db)).Handle(new GetOrderByIdQuery(orderId), CancellationToken.None);
        return dto!.StockLineIds;
    }

    private async Task Deduct(Guid orderId) =>
        await TestFakes.Stock(TestDb.Create(_db)).DeductForOrderAsync(
            orderId, _userId, new WTF.Api.Features.Inventory.StockDeductionOptions(), CancellationToken.None);

    [Fact]
    public async Task OnlyLinesWhoseProductTookStockAreListed()
    {
        var order = _data.AddOrder(OrderStatusEnum.Completed);
        var latteLine = _data.AddLine(order, _latte, 1);
        _data.AddLine(order, _water, 1);
        await Deduct(order);

        (await StockLineIds(order)).ShouldBe([latteLine]);
    }

    [Fact]
    public async Task ALineWhoseAddOnTookStockIsListedToo()
    {
        var order = _data.AddOrder(OrderStatusEnum.Completed);
        var waterLine = _data.AddLine(order, _water, 1);
        _data.AddLine(order, _oat, 1, parentId: waterLine);
        await Deduct(order);

        (await StockLineIds(order)).ShouldBe([waterLine]);
    }

    [Fact]
    public async Task AnOrderThatTookNothingHasNoStockLines()
    {
        var order = _data.AddOrder(OrderStatusEnum.Completed);
        _data.AddLine(order, _water, 2);

        (await StockLineIds(order)).ShouldBeEmpty();
    }

    [Fact]
    public async Task AnOrderFromBeforeStockTrackingHasNoStockLines()
    {
        var order = _data.AddOrder(OrderStatusEnum.Completed, createdAt: DateTime.UtcNow.AddDays(-30));
        _data.AddLine(order, _latte, 1);

        (await StockLineIds(order)).ShouldBeEmpty();
    }

    [Fact]
    public async Task APendingOrderHasNoStockLines()
    {
        var order = _data.AddOrder(OrderStatusEnum.Pending);
        _data.AddLine(order, _latte, 1);

        (await StockLineIds(order)).ShouldBeEmpty();
    }
}
