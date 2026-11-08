using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Inventory.Reordering;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

public class ReorderDatabaseTests
{
    private static async Task<Guid> ItemAsync(SqlTestDatabase database, Guid userId, string name, decimal onHand, decimal? par)
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

    private static async Task LinkAsync(SqlTestDatabase database, Guid userId, Guid itemId, string supplierName, decimal unitsPerPack, decimal? packPrice, bool preferred = true, int? leadDays = 2)
    {
        await using var db = database.CreateContext();
        var supplier = await db.Suppliers.FirstOrDefaultAsync(s => s.Name == supplierName);
        if (supplier is null)
        {
            supplier = new Supplier { Name = supplierName, LeadTimeDays = leadDays, IsActive = true, CreatedAt = DateTime.UtcNow, CreatedBy = userId };
            db.Suppliers.Add(supplier);
        }

        db.ItemSuppliers.Add(new ItemSupplier
        {
            ItemId = itemId,
            Supplier = supplier,
            UnitsPerPack = unitsPerPack,
            PackPrice = packPrice,
            PackName = "carton",
            IsPreferred = preferred,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId
        });
        await db.SaveChangesAsync();
    }

    [SqlFact]
    public async Task List_GroupsBelowParItemsBySupplier_AndRoundsToPacks()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var milk = await ItemAsync(database, user.Id, "Oat Milk", 10, 48);
        var syrup = await ItemAsync(database, user.Id, "Vanilla Syrup", 2, 6);
        var cups = await ItemAsync(database, user.Id, "Cups", 5, 100);
        await ItemAsync(database, user.Id, "Full Shelf", 50, 20);
        await ItemAsync(database, user.Id, "No Par", 0, null);
        await LinkAsync(database, user.Id, milk, "Metro Dairy", 12, 840);
        await LinkAsync(database, user.Id, syrup, "Metro Dairy", 1, 250);

        await using var db = database.CreateContext();
        var list = await new GetReorderListHandler(db).Handle(new GetReorderListQuery(), CancellationToken.None);

        list.BelowParCount.ShouldBe(3);
        list.ItemsWithoutPar.ShouldBe(1);
        list.Groups.Select(g => g.SupplierName).ShouldBe(["Metro Dairy", "No supplier set"]);

        var metro = list.Groups[0];
        metro.LeadTimeDays.ShouldBe(2);
        var oat = metro.Lines.Single(l => l.ItemId == milk);
        oat.SuggestedPacks.ShouldBe(4m);
        oat.SuggestedUnits.ShouldBe(48m);
        oat.EstimatedCost.ShouldBe(3360m);
        metro.Lines.Single(l => l.ItemId == syrup).SuggestedUnits.ShouldBe(4m);
        metro.EstimatedCost.ShouldBe(3360m + 1000m);

        var unassigned = list.Groups[1].Lines.Single();
        unassigned.ItemId.ShouldBe(cups);
        unassigned.SuggestedUnits.ShouldBe(95m);
        unassigned.EstimatedCost.ShouldBeNull();
    }

    [SqlFact]
    public async Task List_DaysOfCoverComesFromRecentSalesNetOfVoids()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var milk = await ItemAsync(database, user.Id, "Oat Milk", 14, 48);
        await using (var seed = database.CreateContext())
        {
            seed.StockMovements.AddRange(
                new StockMovement { ItemId = milk, MovementType = StockMovementTypes.Sale, QuantityDelta = -60, QuantityBefore = 74, QuantityAfter = 14, CreatedAt = DateTime.UtcNow.AddDays(-3), CreatedBy = user.Id },
                new StockMovement { ItemId = milk, MovementType = StockMovementTypes.SaleVoid, QuantityDelta = 4, QuantityBefore = 10, QuantityAfter = 14, CreatedAt = DateTime.UtcNow.AddDays(-2), CreatedBy = user.Id },
                new StockMovement { ItemId = milk, MovementType = StockMovementTypes.Sale, QuantityDelta = -999, QuantityBefore = 0, QuantityAfter = 0, CreatedAt = DateTime.UtcNow.AddDays(-60), CreatedBy = user.Id });
            await seed.SaveChangesAsync();
        }

        await using var db = database.CreateContext();
        var list = await new GetReorderListHandler(db).Handle(new GetReorderListQuery(28), CancellationToken.None);

        // 56 net units over 28 days is 2 a day, so 14 on hand lasts 7 days.
        list.Groups.Single().Lines.Single().DaysOfCover.ShouldBe(7m);
    }

    [SqlFact]
    public async Task SetPar_SavesAndClearsTheLevel_AndRefusesNegatives()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var milk = await ItemAsync(database, user.Id, "Oat Milk", 1, null);

        await using (var db = database.CreateContext())
        {
            var set = new SetParLevelHandler(db, TestRequest.As(user.Id), TestFakes.Audit());
            (await set.Handle(new SetParLevelCommand(milk, 24), CancellationToken.None))!.ParLevel.ShouldBe(24m);
            await Should.ThrowAsync<InvalidOperationException>(() => set.Handle(new SetParLevelCommand(milk, -1), CancellationToken.None));
            (await set.Handle(new SetParLevelCommand(milk, null), CancellationToken.None))!.ParLevel.ShouldBeNull();
            (await set.Handle(new SetParLevelCommand(Guid.NewGuid(), 5), CancellationToken.None)).ShouldBeNull();
        }

        await using var check = database.CreateContext();
        (await new GetParLevelsHandler(check).Handle(new GetParLevelsQuery(), CancellationToken.None)).Single().ParLevel.ShouldBeNull();
    }
}
