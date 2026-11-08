using MediatR;
using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Inventory.Purchasing;
using WTF.Api.Features.Inventory.Receiving;
using WTF.Api.Features.Inventory.Reordering;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

public class PurchaseOrderDatabaseTests
{
    private static async Task<Guid> SupplierAsync(SqlTestDatabase database, Guid userId, string name = "Metro Dairy")
    {
        await using var db = database.CreateContext();
        var supplier = new Supplier { Name = name, IsActive = true, CreatedAt = DateTime.UtcNow, CreatedBy = userId };
        db.Suppliers.Add(supplier);
        await db.SaveChangesAsync();
        return supplier.Id;
    }

    private static async Task<Guid> ItemAsync(SqlTestDatabase database, Guid userId, string name = "Oat Milk", decimal onHand = 0, decimal? par = null)
    {
        await using var db = database.CreateContext();
        var item = new Item
        {
            Id = Guid.NewGuid(),
            Name = name,
            UnitName = "bottle",
            CurrentQuantity = onHand,
            ParLevel = par,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId
        };
        db.Items.Add(item);
        await db.SaveChangesAsync();
        return item.Id;
    }

    private static PurchaseOrderFields Fields(Guid supplierId, params (Guid Item, decimal Packs)[] lines) => new()
    {
        SupplierId = supplierId,
        Lines = [.. lines.Select(l => new PurchaseOrderLineRequest { ItemId = l.Item, Packs = l.Packs, UnitsPerPack = 12, PackPrice = 840, PackName = "carton" })]
    };

    private static CreatePurchaseOrderHandler Create(WTFDbContext db, Guid userId) =>
        new(db, TestRequest.As(userId), TestFakes.Audit());

    private static SetPurchaseOrderStatusHandler Status(WTFDbContext db, Guid userId) =>
        new(db, TestRequest.As(userId), TestFakes.Audit());

    private static async Task<PurchaseOrderDto> SentOrderAsync(SqlTestDatabase database, Guid userId, Guid supplier, params (Guid Item, decimal Packs)[] lines)
    {
        await using var db = database.CreateContext();
        var order = await Create(db, userId).Handle(new CreatePurchaseOrderCommand(Fields(supplier, lines)), CancellationToken.None);
        return (await Status(db, userId).Handle(new SetPurchaseOrderStatusCommand(order.Summary.Id, "send"), CancellationToken.None))!;
    }

    private static Task<StockReceiptDto> ReceiveAsync(SqlTestDatabase database, Guid userId, Guid supplier, Guid? orderId, params (Guid Item, decimal Packs)[] lines)
    {
        var command = new RecordStockReceiptCommand
        {
            SupplierId = supplier,
            ReceivedOn = DateOnly.FromDateTime(DateTime.UtcNow),
            PurchaseOrderId = orderId,
            Lines = [.. lines.Select(l => new ReceiptLineRequest { ItemId = l.Item, Packs = l.Packs, UnitsPerPack = 12, PackPrice = 840 })]
        };
        return Run(database, userId, command);

        static async Task<StockReceiptDto> Run(SqlTestDatabase database, Guid userId, RecordStockReceiptCommand command)
        {
            await using var db = database.CreateContext();
            return await new RecordStockReceiptHandler(db, TestRequest.As(userId), TestFakes.Audit(), TestFakes.Alerts(db))
                .Handle(command, CancellationToken.None);
        }
    }

    [SqlFact]
    public async Task Create_NumbersOrdersUpPerShop_AsDrafts()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var supplier = await SupplierAsync(database, user.Id);
        var item = await ItemAsync(database, user.Id);

        var numbers = new List<int>();
        for (var i = 0; i < 3; i++)
        {
            await using var db = database.CreateContext();
            var order = await Create(db, user.Id).Handle(new CreatePurchaseOrderCommand(Fields(supplier, (item, 2))), CancellationToken.None);
            order.Summary.Status.ShouldBe(PurchaseOrderStatuses.Draft);
            order.Summary.Total.ShouldBe(1680m);
            numbers.Add(order.Summary.PoNumber);
        }

        numbers.ShouldBe([1, 2, 3]);
    }

    [SqlFact]
    public async Task Create_RefusesEmptyDuplicateAndMissingThings()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var supplier = await SupplierAsync(database, user.Id);
        var item = await ItemAsync(database, user.Id);

        var bad = new[]
        {
            Fields(supplier),
            Fields(supplier, (item, 1), (item, 2)),
            Fields(supplier, (Guid.NewGuid(), 1)),
            Fields(Guid.NewGuid(), (item, 1)),
            Fields(supplier, (item, 0)),
        };

        foreach (var fields in bad)
        {
            await using var db = database.CreateContext();
            await Should.ThrowAsync<InvalidOperationException>(() => Create(db, user.Id).Handle(new CreatePurchaseOrderCommand(fields), CancellationToken.None));
        }
    }

    [SqlFact]
    public async Task Update_OnlyWhileDraft_ReplacesTheLines()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var supplier = await SupplierAsync(database, user.Id);
        var milk = await ItemAsync(database, user.Id);
        var syrup = await ItemAsync(database, user.Id, "Syrup");

        await using var db = database.CreateContext();
        var order = await Create(db, user.Id).Handle(new CreatePurchaseOrderCommand(Fields(supplier, (milk, 2))), CancellationToken.None);
        var update = new UpdatePurchaseOrderHandler(db, TestRequest.As(user.Id), TestFakes.Audit());
        var changed = await update.Handle(new UpdatePurchaseOrderCommand(order.Summary.Id, Fields(supplier, (syrup, 5))), CancellationToken.None);

        changed!.Lines.Single().ItemId.ShouldBe(syrup);
        await Status(db, user.Id).Handle(new SetPurchaseOrderStatusCommand(order.Summary.Id, "send"), CancellationToken.None);
        await Should.ThrowAsync<InvalidOperationException>(() =>
            update.Handle(new UpdatePurchaseOrderCommand(order.Summary.Id, Fields(supplier, (milk, 1))), CancellationToken.None));
    }

    [SqlFact]
    public async Task Receiving_PartlyThenFully_MovesTheOrderThroughItsStatuses()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var supplier = await SupplierAsync(database, user.Id);
        var milk = await ItemAsync(database, user.Id);
        var syrup = await ItemAsync(database, user.Id, "Syrup");
        var order = await SentOrderAsync(database, user.Id, supplier, (milk, 4), (syrup, 2));

        var first = await ReceiveAsync(database, user.Id, supplier, order.Summary.Id, (milk, 4));
        first.Summary.PurchaseOrderNumber.ShouldBe(order.Summary.PoNumber);
        await using (var db = database.CreateContext())
        {
            (await db.PurchaseOrders.SingleAsync()).Status.ShouldBe(PurchaseOrderStatuses.PartlyReceived);
        }

        await ReceiveAsync(database, user.Id, supplier, order.Summary.Id, (syrup, 2));

        await using var check = database.CreateContext();
        var stored = await check.PurchaseOrders.Include(o => o.PurchaseOrderLines).SingleAsync();
        stored.Status.ShouldBe(PurchaseOrderStatuses.Received);
        stored.ClosedAt.ShouldNotBeNull();
        stored.PurchaseOrderLines.ShouldAllBe(l => l.PacksReceived == l.PacksOrdered);
        (await check.Items.SingleAsync(i => i.Id == milk)).CurrentQuantity.ShouldBe(48m);
    }

    [SqlFact]
    public async Task Receiving_RefusesADraftAnotherSuppliersOrderAndItemsNotOnIt()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var supplier = await SupplierAsync(database, user.Id);
        var other = await SupplierAsync(database, user.Id, "Farm Fresh");
        var milk = await ItemAsync(database, user.Id);
        var syrup = await ItemAsync(database, user.Id, "Syrup");

        PurchaseOrderDto draft;
        await using (var db = database.CreateContext())
        {
            draft = await Create(db, user.Id).Handle(new CreatePurchaseOrderCommand(Fields(supplier, (milk, 2))), CancellationToken.None);
        }

        await Should.ThrowAsync<InvalidOperationException>(() => ReceiveAsync(database, user.Id, supplier, draft.Summary.Id, (milk, 2)));

        var sent = await SentOrderAsync(database, user.Id, supplier, (milk, 2));
        await Should.ThrowAsync<InvalidOperationException>(() => ReceiveAsync(database, user.Id, other, sent.Summary.Id, (milk, 2)));
        await Should.ThrowAsync<InvalidOperationException>(() => ReceiveAsync(database, user.Id, supplier, sent.Summary.Id, (syrup, 1)));

        await using var check = database.CreateContext();
        (await check.StockReceipts.CountAsync()).ShouldBe(0);
    }

    [SqlFact]
    public async Task SentOrders_CountAsOnOrder_SoTheReorderListDoesNotAskTwice()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var supplier = await SupplierAsync(database, user.Id);
        var milk = await ItemAsync(database, user.Id, onHand: 10, par: 48);

        await using (var db = database.CreateContext())
        {
            var before = await new GetReorderListHandler(db).Handle(new GetReorderListQuery(), CancellationToken.None);
            before.Groups.Single().Lines.Single().SuggestedUnits.ShouldBe(38m);
        }

        var order = await SentOrderAsync(database, user.Id, supplier, (milk, 2));

        await using (var db = database.CreateContext())
        {
            var after = await new GetReorderListHandler(db).Handle(new GetReorderListQuery(), CancellationToken.None);
            var line = after.Groups.Single().Lines.Single();
            line.OnOrder.ShouldBe(24m);
            line.SuggestedUnits.ShouldBe(14m);
        }

        await ReceiveAsync(database, user.Id, supplier, order.Summary.Id, (milk, 1));
        await using var partly = database.CreateContext();
        (await new GetReorderListHandler(partly).Handle(new GetReorderListQuery(), CancellationToken.None))
            .Groups.Single().Lines.Single().OnOrder.ShouldBe(12m);
    }

    [SqlFact]
    public async Task FromReorder_DraftsAnOrderForTheSupplierWithPackSizedQuantities()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var supplier = await SupplierAsync(database, user.Id);
        var milk = await ItemAsync(database, user.Id, onHand: 10, par: 48);
        await using (var seed = database.CreateContext())
        {
            seed.ItemSuppliers.Add(new ItemSupplier { ItemId = milk, SupplierId = supplier, UnitsPerPack = 12, PackPrice = 840, PackName = "carton", IsPreferred = true, CreatedAt = DateTime.UtcNow, CreatedBy = user.Id });
            await seed.SaveChangesAsync();
        }

        await using var db = database.CreateContext();
        var mediator = Substitute.For<IMediator>();
        mediator.Send(Arg.Any<CreatePurchaseOrderCommand>(), Arg.Any<CancellationToken>())
            .Returns(call => Create(db, user.Id).Handle(call.Arg<CreatePurchaseOrderCommand>(), CancellationToken.None));
        var order = await new CreatePurchaseOrderFromReorderHandler(db, mediator)
            .Handle(new CreatePurchaseOrderFromReorderCommand(supplier), CancellationToken.None);

        order.Lines.Single().PacksOrdered.ShouldBe(4m);
        order.Lines.Single().UnitsPerPack.ShouldBe(12m);
        order.Summary.Total.ShouldBe(3360m);
        await Should.ThrowAsync<InvalidOperationException>(() => new CreatePurchaseOrderFromReorderHandler(db, mediator)
            .Handle(new CreatePurchaseOrderFromReorderCommand(Guid.NewGuid()), CancellationToken.None));
    }

    [SqlFact]
    public async Task CancelAndClose_FollowTheRules()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var supplier = await SupplierAsync(database, user.Id);
        var milk = await ItemAsync(database, user.Id);
        var syrup = await ItemAsync(database, user.Id, "Syrup");

        var cancelled = await SentOrderAsync(database, user.Id, supplier, (milk, 2));
        var partly = await SentOrderAsync(database, user.Id, supplier, (milk, 2), (syrup, 2));
        await ReceiveAsync(database, user.Id, supplier, partly.Summary.Id, (milk, 2));

        await using var db = database.CreateContext();
        var handler = Status(db, user.Id);
        (await handler.Handle(new SetPurchaseOrderStatusCommand(cancelled.Summary.Id, "cancel"), CancellationToken.None))!
            .Summary.Status.ShouldBe(PurchaseOrderStatuses.Cancelled);
        await Should.ThrowAsync<InvalidOperationException>(() => handler.Handle(new SetPurchaseOrderStatusCommand(partly.Summary.Id, "cancel"), CancellationToken.None));
        await Should.ThrowAsync<InvalidOperationException>(() => handler.Handle(new SetPurchaseOrderStatusCommand(cancelled.Summary.Id, "close"), CancellationToken.None));
        (await handler.Handle(new SetPurchaseOrderStatusCommand(partly.Summary.Id, "close"), CancellationToken.None))!
            .Summary.Status.ShouldBe(PurchaseOrderStatuses.Received);
    }
}
