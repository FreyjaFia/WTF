using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Items;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Items;

public class CreateItemHandlerTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();
    private readonly IAuditService _audit = TestFakes.Audit();

    private CreateItemHandler Handler() => new(TestDb.Create(_db), TestRequest.As(_userId), _audit);

    [Fact]
    public async Task Handle_ValidItem_TrimsValuesAndSaves()
    {
        await ItemSeed.User(_db, _userId);
        var dto = await Handler().Handle(new CreateItemCommand
        {
            Name = "  Flour ", Sku = " F-1 ", Barcode = "  ", UnitName = " kg ", StockUnitName = " ", CostPrice = 5
        }, CancellationToken.None);

        dto.Name.ShouldBe("Flour");
        dto.Sku.ShouldBe("F-1");
        dto.Barcode.ShouldBeNull();
        dto.UnitName.ShouldBe("kg");
        dto.StockUnitName.ShouldBeNull();
        dto.CreatedBy.ShouldBe(_userId);

        await using var db = TestDb.Create(_db);
        var saved = await db.Items.SingleAsync();
        saved.Id.ShouldBe(dto.Id);
        saved.IsActive.ShouldBeTrue();
    }

    [Fact]
    public async Task Handle_StartingQuantity_CreatesInitialStockMovement()
    {
        await ItemSeed.User(_db, _userId);
        var dto = await Handler().Handle(
            new CreateItemCommand { Name = "Flour", UnitName = "kg", StartingQuantity = 12.5m, CostPrice = 4 },
            CancellationToken.None);

        dto.CurrentQuantity.ShouldBe(12.5m);
        await using var db = TestDb.Create(_db);
        var m = await db.StockMovements.SingleAsync();
        m.ItemId.ShouldBe(dto.Id);
        m.MovementType.ShouldBe("AddStock");
        m.QuantityDelta.ShouldBe(12.5m);
        m.QuantityBefore.ShouldBe(0);
        m.QuantityAfter.ShouldBe(12.5m);
        m.UnitCost.ShouldBe(4m);
        m.Notes.ShouldBe("Initial stock");
        m.CreatedBy.ShouldBe(_userId);
        dto.RecentMovements.Count.ShouldBe(1);
    }

    [Fact]
    public async Task Handle_ZeroStartingQuantity_CreatesNoMovement()
    {
        await ItemSeed.User(_db, _userId);
        await Handler().Handle(new CreateItemCommand { Name = "Flour", UnitName = "kg" }, CancellationToken.None);

        await using var db = TestDb.Create(_db);
        (await db.StockMovements.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Handle_DuplicateSku_ThrowsAndSavesNothing()
    {
        await ItemSeed.User(_db, _userId);
        await ItemSeed.Item(_db, _userId, sku: "F-1");

        await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(
            new CreateItemCommand { Name = "Other", UnitName = "kg", Sku = "F-1" }, CancellationToken.None));

        await using var db = TestDb.Create(_db);
        (await db.Items.CountAsync()).ShouldBe(1);
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Handle_ValidItem_IsAudited()
    {
        await ItemSeed.User(_db, _userId);
        var dto = await Handler().Handle(new CreateItemCommand { Name = "Flour", UnitName = "kg" }, CancellationToken.None);

        await _audit.Received(1).LogAsync(AuditAction.ItemCreated, AuditEntityType.Item, dto.Id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _userId, Arg.Any<CancellationToken>());
    }

    // Rollback of the item insert when the movement save fails: see Database/ItemDatabaseTests.cs.

    // Unique Sku/Barcode indexes and concurrent creates: see Database/ItemDatabaseTests.cs.
}
