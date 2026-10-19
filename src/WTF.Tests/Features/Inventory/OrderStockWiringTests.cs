using MediatR;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Tests.Features.Orders;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class OrderStockWiringTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();
    private readonly OrderSeed _data;
    private readonly Guid _milk;
    private readonly Guid _latte;

    public OrderStockWiringTests()
    {
        _data = new OrderSeed(_db);
        _milk = StockSeed.Item(_db, "Oat Milk", 10000m);
        _latte = _data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, _latte, _milk, 200m);
    }

    private CreateOrderHandler Create() =>
        new(TestDb.Create(_db), TestRequest.As(_userId, AppRoles.Admin), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(),
            TestFakes.Conversations(), TestFakes.Stock(TestDb.Create(_db)));

    private UpdateOrderHandler Update() =>
        new(TestDb.Create(_db), TestRequest.As(_userId, AppRoles.Admin), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(),
            TestFakes.Conversations(), TestFakes.Stock(TestDb.Create(_db)));

    private VoidOrderHandler Void() =>
        new(TestDb.Create(_db), TestRequest.As(_userId, AppRoles.Admin), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(),
            TestFakes.Conversations(), TestFakes.Stock(TestDb.Create(_db)));

    private static OrderItemRequestDto Line(Guid productId, int qty) => new(productId, qty, [], null, null);

    private static CreateOrderCommand NewOrder(OrderStatusEnum status, params OrderItemRequestDto[] lines) =>
        new() { Status = status, Items = [.. lines] };

    private static UpdateOrderCommand Edit(Guid id, OrderStatusEnum status, bool isOverride, params OrderItemRequestDto[] lines) =>
        new()
        {
            Id = id,
            Status = status,
            Items = [.. lines],
            IsOverride = isOverride,
            OverrideReason = isOverride ? "Wrong quantity" : null
        };

    [Fact]
    public async Task Create_AsCompleted_Deducts()
    {
        var dto = await Create().Handle(NewOrder(OrderStatusEnum.Completed, Line(_latte, 3)), CancellationToken.None);

        StockSeed.Balance(_db, _milk).ShouldBe(9400m);
        StockSeed.Movements(_db, _milk).Single().ReferenceId.ShouldBe(dto.Id);
        dto.StockWarnings.ShouldBeEmpty();
    }

    [Theory]
    [InlineData(OrderStatusEnum.Pending)]
    [InlineData(OrderStatusEnum.Cancelled)]
    public async Task Create_AsPendingOrCancelled_DoesNotDeduct(OrderStatusEnum status)
    {
        await Create().Handle(NewOrder(status, Line(_latte, 3)), CancellationToken.None);

        StockSeed.Balance(_db, _milk).ShouldBe(10000m);
        StockSeed.Movements(_db, _milk).ShouldBeEmpty();
    }

    [Fact]
    public async Task Create_BlockingItemShort_ThrowsAndTheMessageNamesTheItem()
    {
        var cup = StockSeed.Item(_db, "Large Cup", 1m, allowNegative: false);
        var big = _data.AddProduct("Big Latte", 180m);
        StockSeed.Link(_db, big, cup, 1m);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(NewOrder(OrderStatusEnum.Completed, Line(big, 2)), CancellationToken.None));

        ex.Message.ShouldContain("Large Cup");
        ex.Message.ShouldContain("short by 1 ml");
    }

    [Fact]
    public async Task Create_WarnOnlyItemShort_CompletesWithAWarningOnTheOrder()
    {
        var dto = await Create().Handle(NewOrder(OrderStatusEnum.Completed, Line(_latte, 60)), CancellationToken.None);

        StockSeed.Balance(_db, _milk).ShouldBe(-2000m);
        dto.StockWarnings!.Single().ShouldContain("Oat Milk is below zero");
    }

    [Fact]
    public async Task Update_PendingToCompleted_DeductsOnce_AndSavingTheCompletedOrderAgainDoesNotDeductTwice()
    {
        var created = await Create().Handle(NewOrder(OrderStatusEnum.Pending, Line(_latte, 2)), CancellationToken.None);

        await Update().Handle(Edit(created.Id, OrderStatusEnum.Completed, false, Line(_latte, 2)), CancellationToken.None);
        StockSeed.Balance(_db, _milk).ShouldBe(9600m);

        await Update().Handle(Edit(created.Id, OrderStatusEnum.Completed, true, Line(_latte, 2)), CancellationToken.None);
        StockSeed.Balance(_db, _milk).ShouldBe(9600m);
        StockSeed.Movements(_db, _milk).Count.ShouldBe(1);
    }

    [Fact]
    public async Task Update_PendingToPending_AndToCancelled_NeverDeduct()
    {
        var created = await Create().Handle(NewOrder(OrderStatusEnum.Pending, Line(_latte, 2)), CancellationToken.None);

        await Update().Handle(Edit(created.Id, OrderStatusEnum.Pending, false, Line(_latte, 5)), CancellationToken.None);
        await Update().Handle(Edit(created.Id, OrderStatusEnum.Cancelled, false, Line(_latte, 5)), CancellationToken.None);

        StockSeed.Balance(_db, _milk).ShouldBe(10000m);
    }

    [Fact]
    public async Task Override_OfACompletedOrder_AppliesOnlyTheNetDifference()
    {
        var created = await Create().Handle(NewOrder(OrderStatusEnum.Completed, Line(_latte, 2)), CancellationToken.None);

        await Update().Handle(Edit(created.Id, OrderStatusEnum.Completed, true, Line(_latte, 5)), CancellationToken.None);
        StockSeed.Balance(_db, _milk).ShouldBe(9000m);

        await Update().Handle(Edit(created.Id, OrderStatusEnum.Completed, true, Line(_latte, 1)), CancellationToken.None);
        StockSeed.Balance(_db, _milk).ShouldBe(9800m);
    }

    [Fact]
    public async Task Void_CompletedOrder_RestoresTheOriginalQuantitiesEvenAfterTheLinkWasEdited()
    {
        var created = await Create().Handle(NewOrder(OrderStatusEnum.Completed, Line(_latte, 3)), CancellationToken.None);
        await using (var db = TestDb.Create(_db))
        {
            foreach (var link in db.ProductItemLinks)
            {
                link.QuantityPerSale = 999m;
            }

            await db.SaveChangesAsync();
        }

        await Void().Handle(new VoidOrderCommand(created.Id, "Customer left"), CancellationToken.None);

        StockSeed.Balance(_db, _milk).ShouldBe(10000m);
    }

    [Fact]
    public async Task Void_CompletedOrderWithALineNotReturned_KeepsThatStockOutAsWaste()
    {
        var created = await Create().Handle(NewOrder(OrderStatusEnum.Completed, Line(_latte, 3)), CancellationToken.None);
        var lineId = created.Items.Single().Id;

        // The roadmap example: 1 L stock 10, a latte linked at 200 ml, sell 3, then void it as not returned.
        await Void().Handle(new VoidOrderCommand(created.Id, "Remade", [lineId]), CancellationToken.None);

        StockSeed.Balance(_db, _milk).ShouldBe(9400m);
        StockSeed.Movements(_db, _milk).Select(m => m.MovementType).ShouldBe(["Sale", "SaleVoid", "Waste"]);
    }

    [Fact]
    public async Task Void_PendingOrder_RestoresNothing()
    {
        var created = await Create().Handle(NewOrder(OrderStatusEnum.Pending, Line(_latte, 3)), CancellationToken.None);

        await Void().Handle(new VoidOrderCommand(created.Id), CancellationToken.None);

        StockSeed.Balance(_db, _milk).ShouldBe(10000m);
        StockSeed.Movements(_db, _milk).ShouldBeEmpty();
    }

    [Fact]
    public async Task Void_ALineThatIsNotOnTheOrder_Throws()
    {
        var created = await Create().Handle(NewOrder(OrderStatusEnum.Completed, Line(_latte, 1)), CancellationToken.None);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Void().Handle(new VoidOrderCommand(created.Id, "x", [Guid.NewGuid()]), CancellationToken.None));

        ex.Message.ShouldContain("not on this order");
    }

    [Fact]
    public async Task OfflineSync_BlockingItemRunsBelowZero_StillSyncsWithAWarning()
    {
        var cup = StockSeed.Item(_db, "Large Cup", 1m, allowNegative: false);
        var big = _data.AddProduct("Big Latte", 180m);
        StockSeed.Link(_db, big, cup, 1m);

        var accessor = TestRequest.As(_userId, AppRoles.Admin);
        var dbContext = TestDb.Create(_db);
        var create = new CreateOrderHandler(
            dbContext, accessor, TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(dbContext));
        var sender = Substitute.For<ISender>();
        sender.Send(Arg.Any<CreateOrderCommand>(), Arg.Any<CancellationToken>())
            .Returns(call => create.Handle(call.Arg<CreateOrderCommand>(), call.Arg<CancellationToken>()));
        var sync = new SyncOfflineOrdersHandler(dbContext, sender, accessor);

        var order = new CreateOrderCommand
        {
            Status = OrderStatusEnum.Completed,
            Items = [new OrderItemRequestDto(big, 3, [], null, null, 180m)],
            OfflineLocalId = "OFF-261021-001",
            CreatedAt = DateTime.UtcNow
        };
        var result = (await sync.Handle(new SyncOfflineOrdersCommand([order]), CancellationToken.None)).Single();

        result.Error.ShouldBeNull();
        result.Status.ShouldBe(OrderStatusEnum.Completed);
        result.StockWarnings!.Single().ShouldContain("Large Cup is below zero");
        StockSeed.Balance(_db, cup).ShouldBe(-2m);
    }
}
