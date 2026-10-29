using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Inventory;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

/// <summary>Stock alerts against a real SQL Server: registers crossing a level together must alert once, not once each.</summary>
public class StockAlertDatabaseTests
{
    [SqlFact]
    public async Task RegistersCrossingTheSameLevelTogether_AlertEachLevelOnce()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var admin = await SqlSeed.UserAsync(database, roleId: 1);
        Guid itemId;
        await using (var db = database.CreateContext())
        {
            var item = new Item
            {
                Id = Guid.NewGuid(),
                Name = "Milk",
                UnitName = "milliliter",
                CurrentQuantity = 1000m,
                WarningQuantity = 500m,
                CriticalQuantity = 200m,
                AllowNegativeStock = true,
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
                CreatedBy = admin.Id,
            };
            db.Items.Add(item);
            await db.SaveChangesAsync();
            itemId = item.Id;
        }

        // Ten registers each take 100 ml and then look at the level, at the same moment.
        await Task.WhenAll(Enumerable.Range(0, 10).Select(async _ =>
        {
            await using var db = database.CreateContext();
            await StockBalance.ApplyAsync(db, itemId, -100m, true, CancellationToken.None);
            await new StockAlertService(db, TestFakes.Notifications(db)).EvaluateAsync([itemId], CancellationToken.None);
        }));

        await using var check = database.CreateContext();
        var rows = await check.Notifications.Where(n => n.UserId == admin.Id).ToListAsync();
        rows.Select(n => n.Data).Distinct().Count().ShouldBe(rows.Count);
        rows.Count.ShouldBeGreaterThan(0);
        (await check.Items.SingleAsync()).LastAlertStatus.ShouldBe((byte)3);
    }

    [SqlFact]
    public async Task ABalanceChange_KeepsAllThreeDecimals()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var admin = await SqlSeed.UserAsync(database, roleId: 1);
        var itemId = Guid.NewGuid();
        await using (var db = database.CreateContext())
        {
            db.Items.Add(new Item
            {
                Id = itemId,
                Name = "Saffron",
                UnitName = "gram",
                CurrentQuantity = 5m,
                AllowNegativeStock = true,
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
                CreatedBy = admin.Id,
            });
            await db.SaveChangesAsync();
        }

        await using (var db = database.CreateContext())
        {
            var change = await StockBalance.ApplyAsync(db, itemId, -0.001m, false, CancellationToken.None);
            change.ShouldNotBeNull();
            change.Value.Before.ShouldBe(5m);
            change.Value.After.ShouldBe(4.999m);
        }

        await using var check = database.CreateContext();
        (await check.Items.SingleAsync()).CurrentQuantity.ShouldBe(4.999m);
    }

    [SqlFact]
    public async Task TwoReminderRunsAtTheSameMoment_LiftEachAlertOnce()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var admin = await SqlSeed.UserAsync(database, roleId: 1);
        var itemId = Guid.NewGuid();
        await using (var db = database.CreateContext())
        {
            db.Items.Add(new Item
            {
                Id = itemId,
                Name = "Milk",
                UnitName = "milliliter",
                CurrentQuantity = 400m,
                WarningQuantity = 500m,
                CriticalQuantity = 200m,
                AllowNegativeStock = true,
                IsActive = true,
                LastAlertStatus = 1,
                CreatedAt = DateTime.UtcNow,
                CreatedBy = admin.Id,
            });
            db.Notifications.Add(new Notification
            {
                UserId = admin.Id,
                Kind = "StockAlert",
                Severity = 1,
                SubjectId = itemId,
                Data = "{\"status\":1,\"quantity\":400}",
                Title = "Low stock: Milk",
                Body = "400 ml left.",
                CreatedAt = DateTime.UtcNow.AddDays(-1),
                ReadAt = DateTime.UtcNow.AddHours(-20),
            });
            await db.SaveChangesAsync();
        }

        var reports = NSubstitute.Substitute.For<WTF.Api.Services.IReportFileStorage>();
        var options = Microsoft.Extensions.Options.Options.Create(new StockAlertRemindersOptions { DryRun = false });
        await Task.WhenAll(Enumerable.Range(0, 2).Select(async _ =>
        {
            await using var db = database.CreateContext();
            await new StockReminderService(
                db, TestFakes.Notifications(db), reports, options,
                Microsoft.Extensions.Logging.Abstractions.NullLogger<StockReminderService>.Instance).RunAsync(CancellationToken.None);
        }));

        await using var check = database.CreateContext();
        var row = await check.Notifications.SingleAsync();
        row.ReminderCount.ShouldBe(1);
        row.ReadAt.ShouldBeNull();
        row.Title.ShouldBe("Still low: Milk");
    }

    [SqlFact]
    public async Task TheScriptsDefaults_StartAnItemAtOk()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var admin = await SqlSeed.UserAsync(database, roleId: 1);
        await using (var db = database.CreateContext())
        {
            db.Items.Add(new Item
            {
                Id = Guid.NewGuid(),
                Name = "Cup",
                UnitName = "piece",
                CurrentQuantity = 50m,
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
                CreatedBy = admin.Id,
            });
            await db.SaveChangesAsync();
        }

        await using var check = database.CreateContext();
        (await check.Items.SingleAsync()).LastAlertStatus.ShouldBe((byte)0);
    }
}
