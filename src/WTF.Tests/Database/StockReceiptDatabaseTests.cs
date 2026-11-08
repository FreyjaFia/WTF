using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Inventory.Receiving;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

public class StockReceiptDatabaseTests
{
    private static RecordStockReceiptHandler Handler(WTFDbContext db, Guid userId) =>
        new(db, TestRequest.As(userId), TestFakes.Audit(), TestFakes.Alerts(db));

    private static DateOnly Today => DateOnly.FromDateTime(DateTime.UtcNow);

    private static async Task<Guid> SupplierAsync(SqlTestDatabase database, Guid userId, string name = "Metro Dairy", bool active = true)
    {
        await using var db = database.CreateContext();
        var supplier = new Supplier { Name = name, IsActive = active, CreatedAt = DateTime.UtcNow, CreatedBy = userId };
        db.Suppliers.Add(supplier);
        await db.SaveChangesAsync();
        return supplier.Id;
    }

    private static async Task<Guid> ItemAsync(SqlTestDatabase database, Guid userId, string name = "Oat Milk", decimal quantity = 0, decimal? cost = null, bool active = true)
    {
        await using var db = database.CreateContext();
        var item = new Item
        {
            Id = Guid.NewGuid(),
            Name = name,
            UnitName = "bottle",
            CurrentQuantity = quantity,
            CostPrice = cost,
            AverageCost = cost,
            IsActive = active,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId
        };
        db.Items.Add(item);
        await db.SaveChangesAsync();
        return item.Id;
    }

    private static RecordStockReceiptCommand Receipt(Guid supplierId, params ReceiptLineRequest[] lines) => new()
    {
        SupplierId = supplierId,
        ReceivedOn = Today,
        InvoiceNumber = "INV-100",
        Lines = [.. lines]
    };

    private static ReceiptLineRequest Line(Guid itemId, decimal packs, decimal unitsPerPack, decimal? packPrice, string? packName = "carton") =>
        new() { ItemId = itemId, Packs = packs, UnitsPerPack = unitsPerPack, PackPrice = packPrice, PackName = packName };

    [SqlFact]
    public async Task Record_AddsPacksTimesUnitsToStock_AndWritesALedgerMovementForTheReceipt()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var supplier = await SupplierAsync(database, user.Id);
        var item = await ItemAsync(database, user.Id, quantity: 4);

        StockReceiptDto dto;
        await using (var db = database.CreateContext())
        {
            dto = await Handler(db, user.Id).Handle(Receipt(supplier, Line(item, 2, 12, 840)), CancellationToken.None);
        }

        dto.Lines.Single().Quantity.ShouldBe(24m);
        dto.Lines.Single().UnitCost.ShouldBe(70m);
        dto.Summary.LinesTotal.ShouldBe(1680m);

        await using var check = database.CreateContext();
        var stored = await check.Items.SingleAsync(i => i.Id == item);
        stored.CurrentQuantity.ShouldBe(28m);
        stored.CostPrice.ShouldBe(70m);
        var movement = await check.StockMovements.SingleAsync(m => m.ItemId == item);
        movement.MovementType.ShouldBe(StockMovementTypes.AddStock);
        movement.ReferenceType.ShouldBe(StockMovementTypes.StockReceiptReference);
        movement.ReferenceId.ShouldBe(dto.Summary.Id);
        movement.QuantityBefore.ShouldBe(4m);
        movement.QuantityAfter.ShouldBe(28m);
        movement.Notes!.ShouldContain("INV-100");
    }

    [SqlFact]
    public async Task Record_WeightsTheAverageCostByWhatWasOnHand()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var supplier = await SupplierAsync(database, user.Id);
        var item = await ItemAsync(database, user.Id, quantity: 12, cost: 60m);

        await using (var db = database.CreateContext())
        {
            await Handler(db, user.Id).Handle(Receipt(supplier, Line(item, 1, 12, 840)), CancellationToken.None);
        }

        await using var check = database.CreateContext();
        (await check.Items.SingleAsync(i => i.Id == item)).AverageCost.ShouldBe(65m);
    }

    [SqlFact]
    public async Task Record_FirstDeliveryCreatesThePreferredSupplierLink_AndPriceChangesAreRecorded()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var supplier = await SupplierAsync(database, user.Id);
        var item = await ItemAsync(database, user.Id);

        foreach (var price in new[] { 800m, 800m, 880m })
        {
            await using var db = database.CreateContext();
            await Handler(db, user.Id).Handle(Receipt(supplier, Line(item, 1, 12, price)), CancellationToken.None);
        }

        await using var check = database.CreateContext();
        var link = await check.ItemSuppliers.Include(l => l.ItemSupplierPriceHistories).SingleAsync(l => l.ItemId == item);
        link.IsPreferred.ShouldBeTrue();
        link.PackPrice.ShouldBe(880m);
        link.UnitsPerPack.ShouldBe(12m);
        link.ItemSupplierPriceHistories.Count.ShouldBe(2);
        link.ItemSupplierPriceHistories.ShouldAllBe(h => h.Source == "Receipt");
    }

    [SqlFact]
    public async Task Record_ReportsTheDifferenceFromTheInvoiceTotal()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var supplier = await SupplierAsync(database, user.Id);
        var item = await ItemAsync(database, user.Id);
        var command = Receipt(supplier, Line(item, 2, 12, 840)) with { InvoiceTotal = 1700m };

        await using var db = database.CreateContext();
        var dto = await Handler(db, user.Id).Handle(command, CancellationToken.None);

        dto.Summary.Difference.ShouldBe(20m);
    }

    [SqlFact]
    public async Task Record_ARetriedRequestIsNotRecordedTwice()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var supplier = await SupplierAsync(database, user.Id);
        var item = await ItemAsync(database, user.Id);
        var command = Receipt(supplier, Line(item, 1, 12, 840)) with { ClientRequestId = Guid.NewGuid() };

        for (var i = 0; i < 2; i++)
        {
            await using var db = database.CreateContext();
            await Handler(db, user.Id).Handle(command, CancellationToken.None);
        }

        await using var check = database.CreateContext();
        (await check.StockReceipts.CountAsync()).ShouldBe(1);
        (await check.Items.SingleAsync(i => i.Id == item)).CurrentQuantity.ShouldBe(12m);
    }

    [SqlFact]
    public async Task Record_RefusesBadReceiptsAndChangesNothing()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var supplier = await SupplierAsync(database, user.Id);
        var inactiveSupplier = await SupplierAsync(database, user.Id, "Closed Co", active: false);
        var item = await ItemAsync(database, user.Id);
        var inactiveItem = await ItemAsync(database, user.Id, "Old Syrup", active: false);

        var bad = new[]
        {
            Receipt(supplier),
            Receipt(supplier, Line(item, 1, 12, 10), Line(item, 1, 12, 10)),
            Receipt(inactiveSupplier, Line(item, 1, 12, 10)),
            Receipt(supplier, Line(inactiveItem, 1, 12, 10)),
            Receipt(supplier, Line(Guid.NewGuid(), 1, 12, 10)),
            Receipt(supplier, Line(item, 0, 12, 10)),
            Receipt(supplier, Line(item, 1, 12, 10)) with { ReceivedOn = Today.AddDays(30) },
            Receipt(Guid.NewGuid(), Line(item, 1, 12, 10)),
        };

        foreach (var command in bad)
        {
            await using var db = database.CreateContext();
            await Should.ThrowAsync<InvalidOperationException>(() => Handler(db, user.Id).Handle(command, CancellationToken.None));
        }

        await using var check = database.CreateContext();
        (await check.StockReceipts.CountAsync()).ShouldBe(0);
        (await check.StockMovements.CountAsync()).ShouldBe(0);
        (await check.Items.SingleAsync(i => i.Id == item)).CurrentQuantity.ShouldBe(0m);
    }

    [SqlFact]
    public async Task Record_SeveralItemsInOneReceipt_AllLandTogether()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var supplier = await SupplierAsync(database, user.Id);
        var milk = await ItemAsync(database, user.Id);
        var syrup = await ItemAsync(database, user.Id, "Vanilla Syrup");

        await using (var db = database.CreateContext())
        {
            await Handler(db, user.Id).Handle(
                Receipt(supplier, Line(milk, 2, 12, 840), Line(syrup, 3, 1, 250, "bottle")), CancellationToken.None);
        }

        await using var query = database.CreateContext();
        var list = await new GetStockReceiptsHandler(query).Handle(new GetStockReceiptsQuery(supplier), CancellationToken.None);
        list.Single().LineCount.ShouldBe(2);
        list.Single().LinesTotal.ShouldBe(2430m);
        (await query.StockMovements.CountAsync(m => m.ReferenceType == StockMovementTypes.StockReceiptReference)).ShouldBe(2);
    }
}
