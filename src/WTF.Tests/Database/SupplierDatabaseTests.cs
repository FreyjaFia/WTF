using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Inventory.Suppliers;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

public class SupplierDatabaseTests
{
    private static SupplierFields Fields(string name, int? leadDays = 2) =>
        new(name, "Ana", "0917", null, null, leadDays, "Cash on delivery", null);

    private static CreateSupplierHandler Create(WTFDbContext db, Guid userId) =>
        new(db, TestRequest.As(userId), TestFakes.Audit());

    private static SaveItemSupplierHandler Save(WTFDbContext db, Guid userId) =>
        new(db, TestRequest.As(userId), TestFakes.Audit());

    private static async Task<Item> ItemAsync(SqlTestDatabase database, Guid userId, string name = "Oat Milk")
    {
        await using var db = database.CreateContext();
        var item = new Item
        {
            Id = Guid.NewGuid(),
            Name = name,
            UnitName = "bottle",
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId
        };
        db.Items.Add(item);
        await db.SaveChangesAsync();
        return item;
    }

    [SqlFact]
    public async Task Create_RejectsADuplicateNameIgnoringCase()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);

        await using (var db = database.CreateContext())
        {
            await Create(db, user.Id).Handle(new CreateSupplierCommand(Fields("Metro Dairy")), CancellationToken.None);
        }

        await using (var db = database.CreateContext())
        {
            var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
                Create(db, user.Id).Handle(new CreateSupplierCommand(Fields("metro dairy")), CancellationToken.None));
            ex.Message.ShouldContain("already exists");
        }
    }

    [SqlFact]
    public async Task Create_RejectsAMissingNameAndANegativeLeadTime()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        await using var db = database.CreateContext();

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create(db, user.Id).Handle(new CreateSupplierCommand(Fields("  ")), CancellationToken.None));
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create(db, user.Id).Handle(new CreateSupplierCommand(Fields("Metro", -1)), CancellationToken.None));
    }

    [SqlFact]
    public async Task SaveLink_FirstSupplierBecomesPreferred_AndMovingThePreferenceClearsTheOld()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var item = await ItemAsync(database, user.Id);
        Guid metro, farm;
        await using (var db = database.CreateContext())
        {
            metro = (await Create(db, user.Id).Handle(new CreateSupplierCommand(Fields("Metro")), CancellationToken.None)).Summary.Id;
            farm = (await Create(db, user.Id).Handle(new CreateSupplierCommand(Fields("Farm Fresh")), CancellationToken.None)).Summary.Id;
        }

        await using (var db = database.CreateContext())
        {
            var links = await Save(db, user.Id).Handle(
                new SaveItemSupplierCommand { ItemId = item.Id, SupplierId = metro, PackName = "carton", UnitsPerPack = 12, PackPrice = 840 },
                CancellationToken.None);
            links!.Single().IsPreferred.ShouldBeTrue();
            links![0].UnitCost.ShouldBe(70m);
        }

        await using (var db = database.CreateContext())
        {
            var links = await Save(db, user.Id).Handle(
                new SaveItemSupplierCommand { ItemId = item.Id, SupplierId = farm, UnitsPerPack = 1, PackPrice = 65, IsPreferred = true },
                CancellationToken.None);
            links!.Count.ShouldBe(2);
            links.Single(l => l.IsPreferred).SupplierName.ShouldBe("Farm Fresh");
            links.Single(l => l.IsCheapest).SupplierName.ShouldBe("Farm Fresh");
        }
    }

    [SqlFact]
    public async Task SaveLink_ChangingThePackPrice_WritesHistoryWithTheChangePercent()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var item = await ItemAsync(database, user.Id);
        Guid metro;
        await using (var db = database.CreateContext())
        {
            metro = (await Create(db, user.Id).Handle(new CreateSupplierCommand(Fields("Metro")), CancellationToken.None)).Summary.Id;
        }

        foreach (var price in new[] { 800m, 800m, 880m })
        {
            await using var db = database.CreateContext();
            await Save(db, user.Id).Handle(
                new SaveItemSupplierCommand { ItemId = item.Id, SupplierId = metro, UnitsPerPack = 12, PackPrice = price },
                CancellationToken.None);
        }

        await using var check = database.CreateContext();
        var links = await ItemSupplierLoader.LoadAsync(check, item.Id, CancellationToken.None);
        var link = links!.Single();
        link.PriceHistory.Count.ShouldBe(2);
        link.PriceHistory[0].OldPackPrice.ShouldBe(800m);
        link.PriceHistory[0].NewPackPrice.ShouldBe(880m);
        link.LastChangePercent.ShouldBe(10m);
    }

    [SqlFact]
    public async Task SaveLink_InactiveSupplier_CannotGetANewItem_ButKeepsExistingOnes()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var milk = await ItemAsync(database, user.Id);
        var syrup = await ItemAsync(database, user.Id, "Vanilla Syrup");
        Guid metro;
        await using (var db = database.CreateContext())
        {
            metro = (await Create(db, user.Id).Handle(new CreateSupplierCommand(Fields("Metro")), CancellationToken.None)).Summary.Id;
            await Save(db, user.Id).Handle(
                new SaveItemSupplierCommand { ItemId = milk.Id, SupplierId = metro, UnitsPerPack = 1, PackPrice = 70 },
                CancellationToken.None);
        }

        await using (var db = database.CreateContext())
        {
            var handler = new SetSupplierActiveHandler(db, TestRequest.As(user.Id), TestFakes.Audit());
            await handler.Handle(new SetSupplierActiveCommand(metro, false), CancellationToken.None);
        }

        await using (var db = database.CreateContext())
        {
            await Should.ThrowAsync<InvalidOperationException>(() => Save(db, user.Id).Handle(
                new SaveItemSupplierCommand { ItemId = syrup.Id, SupplierId = metro, UnitsPerPack = 1 }, CancellationToken.None));
            var update = await Save(db, user.Id).Handle(
                new SaveItemSupplierCommand { ItemId = milk.Id, SupplierId = metro, UnitsPerPack = 1, PackPrice = 72 }, CancellationToken.None);
            update!.Single().PackPrice.ShouldBe(72m);
        }
    }

    [SqlFact]
    public async Task Database_RefusesTwoPreferredSuppliersForOneItem()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var item = await ItemAsync(database, user.Id);
        await using var db = database.CreateContext();
        var a = new Supplier { Name = "A", IsActive = true, CreatedAt = DateTime.UtcNow, CreatedBy = user.Id };
        var b = new Supplier { Name = "B", IsActive = true, CreatedAt = DateTime.UtcNow, CreatedBy = user.Id };
        db.ItemSuppliers.Add(new ItemSupplier { ItemId = item.Id, Supplier = a, UnitsPerPack = 1, IsPreferred = true, CreatedAt = DateTime.UtcNow, CreatedBy = user.Id });
        db.ItemSuppliers.Add(new ItemSupplier { ItemId = item.Id, Supplier = b, UnitsPerPack = 1, IsPreferred = true, CreatedAt = DateTime.UtcNow, CreatedBy = user.Id });

        var ex = await Should.ThrowAsync<DbUpdateException>(() => db.SaveChangesAsync());
        ex.InnerException.ShouldBeOfType<SqlException>().Number.ShouldBe(2601);
    }

    [SqlFact]
    public async Task RemoveLink_DeletesItsPriceHistory_AndLeavesTheSupplier()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var item = await ItemAsync(database, user.Id);
        Guid metro;
        await using (var db = database.CreateContext())
        {
            metro = (await Create(db, user.Id).Handle(new CreateSupplierCommand(Fields("Metro")), CancellationToken.None)).Summary.Id;
            await Save(db, user.Id).Handle(
                new SaveItemSupplierCommand { ItemId = item.Id, SupplierId = metro, UnitsPerPack = 1, PackPrice = 70 }, CancellationToken.None);
        }

        await using (var db = database.CreateContext())
        {
            var handler = new RemoveItemSupplierHandler(db, TestRequest.As(user.Id), TestFakes.Audit());
            var left = await handler.Handle(new RemoveItemSupplierCommand(item.Id, metro), CancellationToken.None);
            left!.ShouldBeEmpty();
        }

        await using var check = database.CreateContext();
        (await check.ItemSupplierPriceHistories.CountAsync()).ShouldBe(0);
        (await check.Suppliers.CountAsync()).ShouldBe(1);
    }
}
