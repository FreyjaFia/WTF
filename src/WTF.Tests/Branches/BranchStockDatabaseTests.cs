using Microsoft.EntityFrameworkCore;
using System.Text.RegularExpressions;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Branches;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Inventory.Transfers;
using WTF.Api.Features.Items;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Database;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Branches;

public class BranchStockDatabaseTests
{
    private static readonly Guid Tenant = TenantDefaults.DefaultTenantId;

    private sealed record Shop(SqlTestDatabase Database, Guid UserId, Guid Makati, Guid Cebu, Guid Milk, Guid Latte);

    // Milk: 1000 ml in Makati (main), 300 ml in Cebu. A latte takes 200 ml.
    private static async Task<Shop> OpenShopAsync(bool allowNegative = false)
    {
        var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        await using var db = database.CreateContext();
        var makati = await db.Branches.Where(b => b.IsMain).Select(b => b.Id).SingleAsync();
        var cebu = SqlTestDatabase.MainBranch(Tenant, "CEB");
        cebu.IsMain = false;
        cebu.Name = "Cebu";
        db.Branches.Add(cebu);
        await db.SaveChangesAsync();

        var latte = await SqlSeed.ProductAsync(database, user.Id, "Latte", 150m);
        var milk = new Item
        {
            Id = Guid.NewGuid(),
            Name = "Oat Milk",
            UnitName = "milliliter",
            WarningQuantity = 500m,
            CriticalQuantity = 200m,
            AllowNegativeStock = allowNegative,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = user.Id
        };
        db.Items.Add(milk);
        db.ProductItemLinks.Add(new ProductItemLink
        {
            Id = Guid.NewGuid(),
            ProductId = latte.Id,
            ItemId = milk.Id,
            QuantityPerSale = 200m,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = user.Id
        });
        await db.SaveChangesAsync();
        db.ItemBranchStocks.RemoveRange(await db.ItemBranchStocks.ToListAsync());
        await db.SaveChangesAsync();
        db.ItemBranchStocks.AddRange(
            new ItemBranchStock { Id = Guid.NewGuid(), TenantId = Tenant, ItemId = milk.Id, BranchId = makati, CurrentQuantity = 1000m },
            new ItemBranchStock { Id = Guid.NewGuid(), TenantId = Tenant, ItemId = milk.Id, BranchId = cebu.Id, CurrentQuantity = 300m });
        await db.SaveChangesAsync();
        return new Shop(database, user.Id, makati, cebu.Id, milk.Id, latte.Id);
    }

    private static WTFDbContext AsLimited(Shop shop, Guid branch, params Guid[] allowed) =>
        shop.Database.CreateContext(new FixedTenant(Tenant), new FixedBranch(allowed.Length == 0 ? [branch] : allowed, branch, true));

    private static WTFDbContext AsAll(Shop shop, Guid? active = null) =>
        shop.Database.CreateContext(new FixedTenant(Tenant), new FixedBranch([shop.Makati, shop.Cebu], active, false));

    private static CreateStockTransferHandler Transfer(WTFDbContext db, Guid userId) =>
        new(db, TestRequest.As(userId, AppRoles.Admin, "UTC"), TestFakes.Audit(), TestFakes.Alerts(db));

    private static CreateStockTransferCommand Send(Guid toBranch, Guid itemId, decimal quantity) => new()
    {
        ToBranchId = toBranch,
        Lines = [new StockTransferLineRequest(itemId, quantity)]
    };

    private static async Task<decimal> QuantityAsync(Shop shop, Guid branch)
    {
        await using var db = shop.Database.CreateContext();
        return await db.ItemBranchStocks.Where(s => s.ItemId == shop.Milk && s.BranchId == branch).Select(s => s.CurrentQuantity).SingleAsync();
    }

    [SqlFact]
    public async Task ASale_TakesStockFromTheBranchTheOrderIsIn_AndOnlyThere()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        await using (var db = AsLimited(shop, shop.Cebu))
        {
            var create = new CreateOrderHandler(db, TestRequest.As(shop.UserId, AppRoles.Admin, "UTC"), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(db), TestFakes.Features);
            var order = await create.Handle(new CreateOrderCommand
            {
                Status = OrderStatusEnum.Completed,
                Items = [new OrderItemRequestDto(shop.Latte, 1, [], null, null)]
            }, CancellationToken.None);
            order.BranchId.ShouldBe(shop.Cebu);
        }

        (await QuantityAsync(shop, shop.Cebu)).ShouldBe(100m);
        (await QuantityAsync(shop, shop.Makati)).ShouldBe(1000m);

        await using var check = shop.Database.CreateContext();
        var movement = await check.StockMovements.SingleAsync();
        movement.BranchId.ShouldBe(shop.Cebu);
        movement.MovementType.ShouldBe("Sale");
    }

    [SqlFact]
    public async Task ASaleInABranchWithTooLittle_IsRefused_EvenWhenAnotherBranchHasPlenty()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        await using var db = AsLimited(shop, shop.Cebu);
        var create = new CreateOrderHandler(db, TestRequest.As(shop.UserId, AppRoles.Admin, "UTC"), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(db), TestFakes.Features);
        var ex = await Should.ThrowAsync<InvalidOperationException>(() => create.Handle(new CreateOrderCommand
        {
            Status = OrderStatusEnum.Completed,
            Items = [new OrderItemRequestDto(shop.Latte, 2, [], null, null)]
        }, CancellationToken.None));
        ex.Message.ShouldContain("Oat Milk");

        (await QuantityAsync(shop, shop.Cebu)).ShouldBe(300m);
        (await QuantityAsync(shop, shop.Makati)).ShouldBe(1000m);
    }

    [SqlFact]
    public async Task AdjustingStock_ChangesOnlyTheBranchThePersonWorksIn()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        await using (var db = AsLimited(shop, shop.Cebu))
        {
            var handler = new AdjustItemStockHandler(db, TestRequest.As(shop.UserId, AppRoles.Admin, "UTC"), TestFakes.Audit(), TestFakes.Alerts(db));
            var dto = await handler.Handle(new AdjustItemStockCommand { ItemId = shop.Milk, CountedQuantity = 250m, Reason = "Count correction" }, CancellationToken.None);
            dto!.CurrentQuantity.ShouldBe(250m);
            dto.BranchStocks!.Single().BranchCode.ShouldBe("CEB");
        }

        (await QuantityAsync(shop, shop.Cebu)).ShouldBe(250m);
        (await QuantityAsync(shop, shop.Makati)).ShouldBe(1000m);
    }

    [SqlFact]
    public async Task ItemQuantities_FollowTheBranch_AndAllBranchesShowsTheTotalWithABreakdown()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        await using (var cebu = AsLimited(shop, shop.Cebu))
        {
            var dto = await new GetItemByIdHandler(cebu).Handle(new GetItemByIdQuery(shop.Milk), CancellationToken.None);
            dto!.CurrentQuantity.ShouldBe(300m);
            dto.BranchStocks!.Select(b => b.BranchCode).ShouldBe(["CEB"]);
        }

        await using var all = AsAll(shop);
        var combined = await new GetItemByIdHandler(all).Handle(new GetItemByIdQuery(shop.Milk), CancellationToken.None);
        combined!.CurrentQuantity.ShouldBe(1300m);
        combined.BranchStocks!.Select(b => (b.BranchCode, b.Quantity, b.Status)).ShouldBe([("MAIN", 1000m, "ok"), ("CEB", 300m, "warning")]);

        var paged = await new GetPagedItemsHandler(all).Handle(new GetPagedItemsQuery(StockStatuses: "warning"), CancellationToken.None);
        paged.Items.Single().Id.ShouldBe(shop.Milk);
    }

    [SqlFact]
    public async Task ATransfer_MovesTheGoods_WritesTwoMovementsWithOneReference_AndAnAuditRecord()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        StockTransferDto result;
        await using (var db = AsLimited(shop, shop.Makati, shop.Makati, shop.Cebu))
        {
            result = await Transfer(db, shop.UserId).Handle(Send(shop.Cebu, shop.Milk, 250.5m), CancellationToken.None);
        }

        result.Summary.FromBranchCode.ShouldBe("MAIN");
        result.Summary.ToBranchCode.ShouldBe("CEB");
        result.Lines.Single().Quantity.ShouldBe(250.5m);
        (await QuantityAsync(shop, shop.Makati)).ShouldBe(749.5m);
        (await QuantityAsync(shop, shop.Cebu)).ShouldBe(550.5m);

        await using var check = shop.Database.CreateContext();
        var movements = await check.StockMovements.OrderBy(m => m.QuantityDelta).ToListAsync();
        movements.Select(m => (m.MovementType, m.BranchId, m.QuantityDelta, m.ReferenceId)).ShouldBe(
        [
            ("TransferOut", shop.Makati, -250.5m, result.Summary.Id),
            ("TransferIn", shop.Cebu, 250.5m, result.Summary.Id)
        ]);
        movements[0].QuantityBefore.ShouldBe(1000m);
        movements[1].QuantityAfter.ShouldBe(550.5m);
        (await check.StockTransfers.CountAsync()).ShouldBe(1);
    }

    [SqlFact]
    public async Task ATransfer_OfMoreThanTheSendingBranchHolds_IsRefusedAndChangesNothing()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        await using (var db = AsLimited(shop, shop.Cebu, shop.Makati, shop.Cebu))
        {
            var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
                Transfer(db, shop.UserId).Handle(Send(shop.Makati, shop.Milk, 400m), CancellationToken.None));
            ex.Message.ShouldContain("Not enough Oat Milk in Cebu");
        }

        (await QuantityAsync(shop, shop.Cebu)).ShouldBe(300m);
        (await QuantityAsync(shop, shop.Makati)).ShouldBe(1000m);
        await using var check = shop.Database.CreateContext();
        (await check.StockTransfers.CountAsync()).ShouldBe(0);
        (await check.StockMovements.CountAsync()).ShouldBe(0);
    }

    [SqlFact]
    public async Task ATransfer_ToTheSameBranchOrAClosedBranch_IsRefused()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        await using (var db = AsLimited(shop, shop.Makati))
        {
            await Should.ThrowAsync<InvalidOperationException>(() =>
                Transfer(db, shop.UserId).Handle(Send(shop.Makati, shop.Milk, 1m), CancellationToken.None));
        }

        await using (var admin = shop.Database.CreateContext())
        {
            (await admin.Branches.SingleAsync(b => b.Id == shop.Cebu)).IsActive = false;
            await admin.SaveChangesAsync();
        }

        await using var db2 = AsLimited(shop, shop.Makati);
        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Transfer(db2, shop.UserId).Handle(Send(shop.Cebu, shop.Milk, 1m), CancellationToken.None));
        ex.Message.ShouldContain("closed");
    }

    [SqlFact]
    public async Task ALimitedPerson_CanSendBetweenTwoOfTheirBranches_ButNeverReadsOrChangesAnotherBranchOtherwise()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        await using (var db = AsLimited(shop, shop.Makati, shop.Makati, shop.Cebu))
        {
            await Transfer(db, shop.UserId).Handle(Send(shop.Cebu, shop.Milk, 100m), CancellationToken.None);
            (await db.StockTransfers.CountAsync()).ShouldBe(1);
        }

        await using (var fresh = AsLimited(shop, shop.Makati))
        {
            await Should.ThrowAsync<InvalidOperationException>(() =>
                StockBalance.ApplyAsync(fresh, shop.Milk, shop.Cebu, -1m, true, CancellationToken.None));
        }

        await using var cebu = AsLimited(shop, shop.Cebu);
        (await cebu.StockMovements.Select(m => m.MovementType).ToListAsync()).ShouldBe(["TransferIn"]);
        (await QuantityAsync(shop, shop.Makati)).ShouldBe(900m);
        (await QuantityAsync(shop, shop.Cebu)).ShouldBe(400m);
    }

    [SqlFact]
    public async Task ALimitedPerson_CannotSendStockToABranchTheyDoNotWorkIn()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        await using (var db = AsLimited(shop, shop.Makati))
        {
            await Should.ThrowAsync<ForbiddenActionException>(() =>
                Transfer(db, shop.UserId).Handle(Send(shop.Cebu, shop.Milk, 100m), CancellationToken.None));
        }

        await using var check = shop.Database.CreateContext();
        (await check.StockTransfers.CountAsync()).ShouldBe(0);
        (await QuantityAsync(shop, shop.Makati)).ShouldBe(1000m);
        (await QuantityAsync(shop, shop.Cebu)).ShouldBe(300m);
    }

    [SqlFact]
    public async Task ALowLevelInOneBranch_AlertsOnlyThePeopleOfThatBranch()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        Guid makatiManager;
        Guid cebuManager;
        await using (var db = shop.Database.CreateContext())
        {
            makatiManager = await AddManagerAsync(db, "mak", shop.Makati);
            cebuManager = await AddManagerAsync(db, "ceb", shop.Cebu);
        }

        await using (var db = AsAll(shop, shop.Cebu))
        {
            var alerts = TestFakes.Alerts(db);
            await using var write = shop.Database.CreateContext();
            var stock = await write.ItemBranchStocks.SingleAsync(s => s.ItemId == shop.Milk && s.BranchId == shop.Cebu);
            stock.CurrentQuantity = 150m;
            await write.SaveChangesAsync();

            await alerts.EvaluateAsync([shop.Milk], shop.Cebu, CancellationToken.None);
        }

        await using var check = shop.Database.CreateContext();
        var notified = await check.Notifications.Select(n => new { n.UserId, n.Title }).ToListAsync();
        notified.Select(n => n.UserId).Distinct().ShouldContain(cebuManager);
        notified.Select(n => n.UserId).ShouldNotContain(makatiManager);
        notified.First(n => n.UserId == cebuManager).Title.ShouldBe("Critically low: Oat Milk (Cebu)");

        (await check.ItemBranchStocks.SingleAsync(s => s.BranchId == shop.Cebu)).LastAlertStatus.ShouldBe((byte)2);
        (await check.ItemBranchStocks.SingleAsync(s => s.BranchId == shop.Makati)).LastAlertStatus.ShouldBe((byte)0);
    }

    [SqlFact]
    public async Task ANewBranch_StartsWithAZeroRowForEveryItem_AndANewItemGetsARowInEveryBranch()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        Guid bgc;
        await using (var db = shop.Database.CreateContext())
        {
            var branch = SqlTestDatabase.MainBranch(Tenant, "BGC");
            branch.IsMain = false;
            branch.Name = "BGC";
            db.Branches.Add(branch);
            await db.SaveChangesAsync();
            bgc = branch.Id;
            await StockBranchRows.AddBranchAsync(db, bgc, CancellationToken.None);
        }

        await using (var db = AsLimited(shop, shop.Makati))
        {
            var created = await new CreateItemHandler(db, TestRequest.As(shop.UserId, AppRoles.Admin, "UTC"), TestFakes.Audit(), TestFakes.Alerts(db))
                .Handle(new CreateItemCommand { Name = "Cups", UnitName = "piece", StartingQuantity = 80m }, CancellationToken.None);
            created.CurrentQuantity.ShouldBe(80m);
        }

        await using var check = shop.Database.CreateContext();
        (await check.ItemBranchStocks.CountAsync(s => s.BranchId == bgc)).ShouldBe(2);
        var cups = await check.ItemBranchStocks.Where(s => s.Item.Name == "Cups").ToListAsync();
        cups.Count.ShouldBe(3);
        cups.Single(s => s.BranchId == shop.Makati).CurrentQuantity.ShouldBe(80m);
        cups.Where(s => s.BranchId != shop.Makati).Select(s => s.CurrentQuantity).ShouldAllBe(q => q == 0m);
    }

    [SqlFact]
    public async Task ABranchThatStillHoldsStock_CannotBeClosed()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        var scope = new FixedBranch([shop.Makati, shop.Cebu], shop.Makati, false);
        await using var db = shop.Database.CreateContext(new FixedTenant(Tenant), scope);
        var check = await BranchClosing.CheckAsync(db, scope, shop.Cebu, CancellationToken.None);
        check!.CanClose.ShouldBeFalse();
        check.ItemsWithStock.ShouldBe(1);
        check.Blockers.ShouldContain(b => b.Contains("still hold") || b.Contains("still holds"));
    }

    [SqlFact]
    public async Task DailyClose_ForAllBranches_ListsEachBranchWithItsOwnNetSales_AndOneBranchSeesNoSplit()
    {
        var shop = await OpenShopAsync(allowNegative: true);
        await using var _ = shop.Database;
        foreach (var (branch, count) in new[] { (shop.Makati, 2), (shop.Cebu, 1) })
        {
            await using var db = AsLimited(shop, branch);
            var create = new CreateOrderHandler(db, TestRequest.As(shop.UserId, AppRoles.Admin, "UTC"), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(db), TestFakes.Features);
            for (var i = 0; i < count; i++)
            {
                await create.Handle(new CreateOrderCommand
                {
                    Status = OrderStatusEnum.Completed,
                    Items = [new OrderItemRequestDto(shop.Latte, 1, [], null, null)]
                }, CancellationToken.None);
            }
        }

        var query = new GetDailyCloseReportQuery { FromDate = DateTime.UtcNow.Date, ToDate = DateTime.UtcNow.Date };

        await using (var all = AsAll(shop))
        {
            var rows = await new GetDailyCloseReportHandler(all, TestRequest.As(shop.UserId, AppRoles.Admin, "UTC")).Handle(query, CancellationToken.None);
            var branches = rows.Where(r => r.Section == GetDailyCloseReportHandler.BranchesSection).ToDictionary(r => r.Label);
            branches["Cebu"].OrderCount.ShouldBe(1);
            branches["Cebu"].Amount.ShouldBe(150m);
            branches["Main"].OrderCount.ShouldBe(2);
            branches["Main"].Amount.ShouldBe(300m);
            rows.Single(r => r.Label == "Net sales").Amount.ShouldBe(450m);
        }

        await using (var one = AsLimited(shop, shop.Cebu))
        {
            var rows = await new GetDailyCloseReportHandler(one, TestRequest.As(shop.UserId, AppRoles.Admin, "UTC")).Handle(query, CancellationToken.None);
            rows.ShouldNotContain(r => r.Section == GetDailyCloseReportHandler.BranchesSection);
            rows.Single(r => r.Label == "Net sales").Amount.ShouldBe(150m);
        }
    }

    [SqlFact]
    public async Task TheMigrationScript_MovesStockToMain_GivesOtherBranchesZero_AndIsSafeToRunTwice()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        // Put the database back to how it looked before this script: drop the new tables, give Items the old columns.
        await using (var db = shop.Database.CreateContext())
        {
            await db.Database.ExecuteSqlRawAsync("DROP TABLE dbo.StockTransferLines; DROP TABLE dbo.StockTransfers; DROP TABLE dbo.ItemBranchStocks;");
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE dbo.Items ADD CurrentQuantity DECIMAL(18, 3) NOT NULL DEFAULT 0, LastAlertStatus TINYINT NOT NULL DEFAULT 0;");
            await db.Database.ExecuteSqlRawAsync("UPDATE dbo.Items SET CurrentQuantity = 750.5, LastAlertStatus = 1;");
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE dbo.StockMovements ADD CONSTRAINT CK_StockMovements_MovementType CHECK (MovementType IN (N'AddStock', N'Sale', N'SaleVoid', N'Waste', N'WasteReversed', N'Adjustment', N'Count', N'SaleDeduction', N'ManualAdjustment', N'Correction', N'Spoilage'));");
        }

        await RunScriptAsync(shop.Database, "20261230_add_item_branch_stocks.sql");
        await RunScriptAsync(shop.Database, "20261230_add_item_branch_stocks.sql");
        await RunScriptAsync(shop.Database, "20261231_allow_transfer_movements.sql");
        await RunScriptAsync(shop.Database, "20261231_allow_transfer_movements.sql");
        await RunScriptAsync(shop.Database, "20270102_add_item_branch_levels_and_cost.sql");
        await RunScriptAsync(shop.Database, "20270102_add_item_branch_levels_and_cost.sql");

        (await QuantityAsync(shop, shop.Makati)).ShouldBe(750.5m);
        (await QuantityAsync(shop, shop.Cebu)).ShouldBe(0m);
        await using var check = shop.Database.CreateContext();
        (await check.ItemBranchStocks.CountAsync()).ShouldBe(2);
        (await check.ItemBranchStocks.SingleAsync(s => s.BranchId == shop.Makati)).LastAlertStatus.ShouldBe((byte)1);
        (await check.Database.SqlQueryRaw<decimal>("SELECT CurrentQuantity AS [Value] FROM dbo.Items").SingleAsync()).ShouldBe(750.5m);

        // The movement types check now allows both sides of a transfer (the staging seed hit the old list).
        var itemId = await check.Database.SqlQueryRaw<Guid>("SELECT Id AS [Value] FROM dbo.Items").SingleAsync();
        await check.Database.ExecuteSqlRawAsync(
            "INSERT INTO dbo.StockMovements (Id, TenantId, BranchId, ItemId, MovementType, QuantityDelta, QuantityBefore, QuantityAfter, CreatedAt, CreatedBy) " +
            "SELECT NEWID(), TenantId, {0}, Id, N'TransferOut', -1, 750.5, 749.5, SYSUTCDATETIME(), (SELECT TOP 1 Id FROM dbo.Users) FROM dbo.Items WHERE Id = {1}",
            shop.Makati, itemId);
    }

    private static async Task<Guid> AddManagerAsync(WTFDbContext db, string username, Guid branchId)
    {
        var id = Guid.NewGuid();
        db.Users.Add(new User
        {
            Id = id,
            Username = username,
            PasswordHash = "x",
            FirstName = username,
            LastName = "Mgr",
            IsActive = true,
            RoleId = 6,
            BranchScope = 1,
            DefaultBranchId = branchId,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = id
        });
        db.UserBranches.Add(new UserBranch { UserId = id, BranchId = branchId, TenantId = Tenant, CreatedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
        return id;
    }

    private static async Task RunScriptAsync(SqlTestDatabase database, string scriptName)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !Directory.Exists(Path.Combine(directory.FullName, "tools", "sql")))
        {
            directory = directory.Parent;
        }

        var text = await File.ReadAllTextAsync(Path.Combine(directory!.FullName, "tools", "sql", scriptName));
        await using var db = database.CreateContext();
        foreach (var batch in Regex.Split(text, @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase))
        {
            if (!string.IsNullOrWhiteSpace(batch))
            {
                await db.Database.ExecuteSqlRawAsync(batch);
            }
        }
    }
}
