using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Inventory.Waste;
using WTF.Api.Features.Inventory.Waste.DTOs;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

public class StockWasteFixesDatabaseTests
{
    [SqlFact]
    public async Task ReverseWaste_ConcurrentCalls_AddStockOnce()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var admin = await SqlSeed.UserAsync(database, roleId: 1);
        var (itemId, reasonId) = await SeedItemAndReasonAsync(database, admin.Id, 900m);
        var wasteId = await SeedEntryAsync(database, itemId, reasonId, admin.Id, 100m, StockWasteStatuses.Recorded);

        var successes = 0;
        var failures = 0;
        await Task.WhenAll(Enumerable.Range(0, 5).Select(async _ =>
        {
            await using var db = database.CreateContext();
            var handler = new ReverseWasteHandler(
                db, TestRequest.As(admin.Id, AppRoles.Admin), TestFakes.Audit(), TestFakes.Alerts(db), TestFakes.Notifications(db));
            try
            {
                await handler.Handle(new ReverseWasteCommand(wasteId, "Counted wrong"), CancellationToken.None);
                Interlocked.Increment(ref successes);
            }
            catch (InvalidOperationException)
            {
                Interlocked.Increment(ref failures);
            }
        }));

        successes.ShouldBe(1);
        failures.ShouldBe(4);

        await using var check = database.CreateContext();
        (await check.Items.AsNoTracking().SingleAsync(i => i.Id == itemId)).CurrentQuantity.ShouldBe(1000m);
        (await check.StockMovements.CountAsync(m => m.ItemId == itemId && m.MovementType == StockMovementTypes.WasteReversed))
            .ShouldBe(1);
        var waste = await check.StockWastes.AsNoTracking().SingleAsync(w => w.Id == wasteId);
        waste.Status.ShouldBe(StockWasteStatuses.Reversed);
        waste.ReversalMovementId.ShouldNotBeNull();
    }

    [SqlFact]
    public async Task ConfirmAndDispute_Concurrent_OnlyOneWins()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var admin = await SqlSeed.UserAsync(database, roleId: 1);
        var (itemId, reasonId) = await SeedItemAndReasonAsync(database, admin.Id, 500m);
        var wasteId = await SeedEntryAsync(database, itemId, reasonId, admin.Id, 300m, StockWasteStatuses.PendingReview);

        var successes = 0;
        await Task.WhenAll(Enumerable.Range(0, 6).Select(async index =>
        {
            await using var db = database.CreateContext();
            var http = TestRequest.As(admin.Id, AppRoles.Admin);
            try
            {
                if (index % 2 == 0)
                {
                    await new ConfirmWasteHandler(db, http, TestFakes.Audit(), TestFakes.Notifications(db))
                        .Handle(new ConfirmWasteCommand(wasteId, null), CancellationToken.None);
                }
                else
                {
                    await new DisputeWasteHandler(db, http, TestFakes.Audit(), TestFakes.Notifications(db))
                        .Handle(new DisputeWasteCommand(wasteId, "Not what I saw"), CancellationToken.None);
                }

                Interlocked.Increment(ref successes);
            }
            catch (InvalidOperationException)
            {
            }
        }));

        successes.ShouldBe(1);
        await using var check = database.CreateContext();
        var waste = await check.StockWastes.AsNoTracking().SingleAsync(w => w.Id == wasteId);
        waste.Status.ShouldBeOneOf(StockWasteStatuses.Confirmed, StockWasteStatuses.Disputed);
        waste.ReviewedBy.ShouldBe(admin.Id);
    }

    [SqlFact]
    public async Task RecordWaste_RetryWithSameClientRequestId_ReturnsSameEntry()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var admin = await SqlSeed.UserAsync(database, roleId: 1);
        var (itemId, reasonId) = await SeedItemAndReasonAsync(database, admin.Id, 1000m);
        var requestId = Guid.NewGuid();

        var first = await RecordAsync(database, admin.Id, itemId, reasonId, requestId);
        var second = await RecordAsync(database, admin.Id, itemId, reasonId, requestId);

        first.ShouldNotBeNull();
        second.ShouldNotBeNull();
        second.Id.ShouldBe(first.Id);

        await using var check = database.CreateContext();
        (await check.StockWastes.CountAsync(w => w.ItemId == itemId)).ShouldBe(1);
        (await check.Items.AsNoTracking().SingleAsync(i => i.Id == itemId)).CurrentQuantity.ShouldBe(950m);
    }

    [SqlFact]
    public async Task RecordWaste_ConcurrentRetries_DeductOnce()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var admin = await SqlSeed.UserAsync(database, roleId: 1);
        var (itemId, reasonId) = await SeedItemAndReasonAsync(database, admin.Id, 1000m);
        var requestId = Guid.NewGuid();

        var results = await Task.WhenAll(Enumerable.Range(0, 5)
            .Select(_ => RecordAsync(database, admin.Id, itemId, reasonId, requestId)));

        results.ShouldAllBe(r => r != null);
        results.Select(r => r!.Id).Distinct().Count().ShouldBe(1);

        await using var check = database.CreateContext();
        (await check.StockWastes.CountAsync(w => w.ItemId == itemId)).ShouldBe(1);
        (await check.StockMovements.CountAsync(m => m.ItemId == itemId && m.MovementType == StockMovementTypes.Waste))
            .ShouldBe(1);
        (await check.Items.AsNoTracking().SingleAsync(i => i.Id == itemId)).CurrentQuantity.ShouldBe(950m);
    }

    private static async Task<StockWasteDto?> RecordAsync(
        SqlTestDatabase database, Guid userId, Guid itemId, int reasonId, Guid requestId)
    {
        await using var db = database.CreateContext();
        var handler = new RecordWasteHandler(
            db, TestRequest.As(userId, AppRoles.Admin), TestFakes.Audit(), TestFakes.Alerts(db), TestFakes.Notifications(db));
        return await handler.Handle(
            new RecordWasteCommand(itemId, 50m, reasonId, null, StockWasteStatuses.SourcePos, requestId),
            CancellationToken.None);
    }

    private static async Task<(Guid ItemId, int ReasonId)> SeedItemAndReasonAsync(
        SqlTestDatabase database, Guid createdBy, decimal quantity)
    {
        await using var db = database.CreateContext();
        var item = new Item
        {
            Id = Guid.NewGuid(),
            Name = "Milk",
            UnitName = "milliliter",
            CurrentQuantity = quantity,
            AllowNegativeStock = true,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = createdBy,
        };
        var reason = new WasteReason
        {
            Name = "Spilled or dropped",
            RequiresNote = false,
            IsSystem = false,
            IsActive = true,
            SortOrder = 10,
            CreatedAt = DateTime.UtcNow,
        };
        db.Items.Add(item);
        db.WasteReasons.Add(reason);
        await db.SaveChangesAsync();
        return (item.Id, reason.Id);
    }

    private static async Task<Guid> SeedEntryAsync(
        SqlTestDatabase database, Guid itemId, int reasonId, Guid createdBy, decimal quantity, byte status)
    {
        await using var db = database.CreateContext();
        var wasteId = Guid.NewGuid();
        var movement = new StockMovement
        {
            Id = Guid.NewGuid(),
            ItemId = itemId,
            MovementType = StockMovementTypes.Waste,
            QuantityDelta = -quantity,
            QuantityBefore = 0m,
            QuantityAfter = 0m,
            ReferenceType = StockMovementTypes.StockWasteReference,
            ReferenceId = wasteId,
            Notes = "Spilled or dropped",
            CreatedAt = DateTime.UtcNow,
            CreatedBy = createdBy,
        };
        db.StockMovements.Add(movement);
        db.StockWastes.Add(new StockWaste
        {
            Id = wasteId,
            ItemId = itemId,
            StockMovementId = movement.Id,
            Quantity = quantity,
            WasteReasonId = reasonId,
            ReasonName = "Spilled or dropped",
            Status = status,
            RequiresReview = status == StockWasteStatuses.PendingReview,
            Source = StockWasteStatuses.SourceItemDetails,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = createdBy,
        });
        await db.SaveChangesAsync();
        return wasteId;
    }
}
