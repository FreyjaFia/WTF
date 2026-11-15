using WTF.Api.Features.Inventory.Counts;
using WTF.Api.Features.Inventory.Purchasing;
using WTF.Api.Features.Inventory.Receiving;
using WTF.Domain.Entities;
using WTF.Tests.Features.Items;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class PagedPurchasingListsTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();

    private async Task<Supplier> SeedSupplier(string name)
    {
        await using var db = TestDb.Create(_db);
        var supplier = new Supplier { Id = Guid.NewGuid(), Name = name, IsActive = true, CreatedAt = DateTime.UtcNow, CreatedBy = _userId };
        db.Suppliers.Add(supplier);
        await db.SaveChangesAsync();
        return supplier;
    }

    private async Task<Guid> SeedOrder(Guid supplierId, int number, byte status, decimal? packPrice, decimal packs, Guid itemId, DateTime createdAt)
    {
        await using var db = TestDb.Create(_db);
        var order = new PurchaseOrder { Id = Guid.NewGuid(), PoNumber = number, SupplierId = supplierId, Status = status, CreatedAt = createdAt, CreatedBy = _userId };
        db.PurchaseOrders.Add(order);
        db.PurchaseOrderLines.Add(new PurchaseOrderLine { Id = Guid.NewGuid(), PurchaseOrderId = order.Id, ItemId = itemId, UnitsPerPack = 1, PackPrice = packPrice, PacksOrdered = packs });
        await db.SaveChangesAsync();
        return order.Id;
    }

    private async Task<Guid> SeedReceipt(Guid supplierId, Guid itemId, DateOnly on, decimal? packPrice, decimal packs, string? invoice = null)
    {
        await using var db = TestDb.Create(_db);
        var receipt = new StockReceipt { Id = Guid.NewGuid(), SupplierId = supplierId, ReceivedOn = on, InvoiceNumber = invoice, CreatedAt = DateTime.UtcNow, CreatedBy = _userId };
        db.StockReceipts.Add(receipt);
        db.StockReceiptLines.Add(new StockReceiptLine { Id = Guid.NewGuid(), ReceiptId = receipt.Id, ItemId = itemId, Packs = packs, UnitsPerPack = 1, PackPrice = packPrice, Quantity = packs });
        await db.SaveChangesAsync();
        return receipt.Id;
    }

    private async Task<Guid> SeedCount(string name, byte status, DateTime createdAt, Guid itemId, int counted, int total)
    {
        await using var db = TestDb.Create(_db);
        var count = new StockCount { Id = Guid.NewGuid(), Name = name, Status = status, CreatedAt = createdAt, CreatedBy = _userId };
        db.StockCounts.Add(count);
        for (var i = 0; i < total; i++)
        {
            var item = await ItemSeed.Item(_db, _userId, $"{name}-{i}");
            db.StockCountLines.Add(new StockCountLine { Id = Guid.NewGuid(), CountId = count.Id, ItemId = item.Id, CountedQuantity = i < counted ? 1m : null });
        }

        await db.SaveChangesAsync();
        return count.Id;
    }

    [Fact]
    public async Task Counts_PageNewestFirstAndClampPastTheEnd()
    {
        await ItemSeed.User(_db, _userId);
        var item = (await ItemSeed.Item(_db, _userId, "Milk")).Id;
        var start = new DateTime(2026, 3, 1, 0, 0, 0, DateTimeKind.Utc);
        var ids = new List<Guid>();
        for (var i = 0; i < 5; i++)
        {
            ids.Add(await SeedCount($"C{i}", StockCountStatuses.Open, start.AddDays(i), item, 0, 0));
        }

        var handler = new GetPagedStockCountsHandler(TestDb.Create(_db));
        var second = await handler.Handle(new GetPagedStockCountsQuery(PageSize: 2, Page: 2), default);
        var past = await handler.Handle(new GetPagedStockCountsQuery(PageSize: 2, Page: 9), default);

        second.Items.Select(i => i.Id).ShouldBe([ids[2], ids[1]]);
        second.TotalCount.ShouldBe(5);
        past.Page.ShouldBe(3);
        past.Items.Select(i => i.Id).ShouldBe([ids[0]]);
    }

    [Fact]
    public async Task Counts_SortByProgressUsesTheWholeList()
    {
        await ItemSeed.User(_db, _userId);
        var item = (await ItemSeed.Item(_db, _userId, "Milk")).Id;
        var now = DateTime.UtcNow;
        var half = await SeedCount("Half", StockCountStatuses.Open, now, item, 1, 2);
        var done = await SeedCount("Done", StockCountStatuses.Open, now.AddMinutes(1), item, 2, 2);
        var none = await SeedCount("None", StockCountStatuses.Open, now.AddMinutes(2), item, 0, 2);

        var result = await new GetPagedStockCountsHandler(TestDb.Create(_db))
            .Handle(new GetPagedStockCountsQuery(SortBy: "progress", SortDirection: "asc"), default);

        result.Items.Select(i => i.Id).ShouldBe([none, half, done]);
    }

    [Fact]
    public async Task Counts_FilterByStatus()
    {
        await ItemSeed.User(_db, _userId);
        var item = (await ItemSeed.Item(_db, _userId, "Milk")).Id;
        var open = await SeedCount("A", StockCountStatuses.Open, DateTime.UtcNow, item, 0, 0);
        await SeedCount("B", StockCountStatuses.Posted, DateTime.UtcNow, item, 0, 0);

        var result = await new GetPagedStockCountsHandler(TestDb.Create(_db))
            .Handle(new GetPagedStockCountsQuery(Status: StockCountStatuses.Open), default);

        result.Items.Select(i => i.Id).ShouldBe([open]);
    }

    [Fact]
    public async Task Receipts_SearchSortAndPage()
    {
        await ItemSeed.User(_db, _userId);
        var item = (await ItemSeed.Item(_db, _userId, "Milk")).Id;
        var beans = await SeedSupplier("Beans Co");
        var dairy = await SeedSupplier("Dairy Ltd");
        var cheap = await SeedReceipt(beans.Id, item, new DateOnly(2026, 3, 1), 2m, 1m, "INV-1");
        var dear = await SeedReceipt(dairy.Id, item, new DateOnly(2026, 3, 2), 50m, 2m, "INV-2");
        var unpriced = await SeedReceipt(dairy.Id, item, new DateOnly(2026, 3, 3), null, 1m);

        var handler = new GetPagedStockReceiptsHandler(TestDb.Create(_db));

        (await handler.Handle(new GetPagedStockReceiptsQuery(), default)).Items.Select(i => i.Id).ShouldBe([unpriced, dear, cheap]);
        (await handler.Handle(new GetPagedStockReceiptsQuery(Search: "Beans"), default)).Items.Select(i => i.Id).ShouldBe([cheap]);
        (await handler.Handle(new GetPagedStockReceiptsQuery(Search: "INV-2"), default)).Items.Select(i => i.Id).ShouldBe([dear]);
        (await handler.Handle(new GetPagedStockReceiptsQuery(SortBy: "total", SortDirection: "desc"), default)).Items.Select(i => i.Id).ShouldBe([dear, cheap, unpriced]);
        (await handler.Handle(new GetPagedStockReceiptsQuery(SortBy: "receipt", SortDirection: "asc", PageSize: 2, Page: 2), default)).Items.Count.ShouldBe(1);
    }

    [Fact]
    public async Task Orders_StatusFilterKeepsTheCountsOfEveryStatus()
    {
        await ItemSeed.User(_db, _userId);
        var item = (await ItemSeed.Item(_db, _userId, "Milk")).Id;
        var supplier = await SeedSupplier("Beans Co");
        var now = DateTime.UtcNow;
        var draft = await SeedOrder(supplier.Id, 1, PurchaseOrderStatuses.Draft, 5m, 2m, item, now);
        await SeedOrder(supplier.Id, 2, PurchaseOrderStatuses.Sent, 5m, 1m, item, now.AddMinutes(1));
        await SeedOrder(supplier.Id, 3, PurchaseOrderStatuses.Sent, null, 1m, item, now.AddMinutes(2));

        var result = await new GetPagedPurchaseOrdersHandler(TestDb.Create(_db))
            .Handle(new GetPagedPurchaseOrdersQuery(Status: PurchaseOrderStatuses.Draft), default);

        result.Items.Select(i => i.Id).ShouldBe([draft]);
        result.Facets!["all"].ShouldBe(3);
        result.Facets[PurchaseOrderStatuses.Sent.ToString()].ShouldBe(2);
    }

    [Fact]
    public async Task Orders_SearchBySupplierAndPoNumber_AndSortByTotal()
    {
        await ItemSeed.User(_db, _userId);
        var item = (await ItemSeed.Item(_db, _userId, "Milk")).Id;
        var beans = await SeedSupplier("Beans Co");
        var dairy = await SeedSupplier("Dairy Ltd");
        var now = DateTime.UtcNow;
        var small = await SeedOrder(beans.Id, 7, PurchaseOrderStatuses.Sent, 5m, 1m, item, now);
        var big = await SeedOrder(dairy.Id, 8, PurchaseOrderStatuses.Sent, 5m, 10m, item, now.AddMinutes(1));

        var handler = new GetPagedPurchaseOrdersHandler(TestDb.Create(_db));

        (await handler.Handle(new GetPagedPurchaseOrdersQuery(Search: "Dairy"), default)).Items.Select(i => i.Id).ShouldBe([big]);
        (await handler.Handle(new GetPagedPurchaseOrdersQuery(Search: "PO-7"), default)).Items.Select(i => i.Id).ShouldBe([small]);
        (await handler.Handle(new GetPagedPurchaseOrdersQuery(SortBy: "total", SortDirection: "desc"), default)).Items.Select(i => i.Id).ShouldBe([big, small]);
    }
}
