using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Items;
using WTF.Api.Services;
using WTF.Tests.Features.Inventory;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Items;

public class DeleteItemHandlerTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly IStockAlertService _alerts = Substitute.For<IStockAlertService>();

    private DeleteItemHandler Handler() => new(TestDb.Create(_db), TestRequest.As(_userId), _audit, _alerts);

    [Fact]
    public async Task Handle_ExistingItem_SoftDeletesAndAudits()
    {
        var item = await ItemSeed.Item(_db, _userId);
        var ok = await Handler().Handle(new DeleteItemCommand(item.Id), CancellationToken.None);

        ok.ShouldBeTrue();
        await using var db = TestDb.Create(_db);
        var saved = await db.Items.SingleAsync(); // row is kept
        saved.IsActive.ShouldBeFalse();
        saved.UpdatedBy.ShouldBe(_userId);
        saved.UpdatedAt.ShouldNotBeNull();
        await _audit.Received(1).LogAsync(AuditAction.ItemDeleted, AuditEntityType.Item, item.Id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_MissingItem_ReturnsFalseWithoutAudit()
    {
        var ok = await Handler().Handle(new DeleteItemCommand(Guid.NewGuid()), CancellationToken.None);

        ok.ShouldBeFalse();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
        await _alerts.DidNotReceiveWithAnyArgs().EvaluateAsync(default!, default);
    }

    [Fact]
    public async Task Handle_ItemStillUsedByAnActiveProduct_IsRefusedAndNothingChanges()
    {
        var item = await ItemSeed.Item(_db, _userId, name: "Oat Milk", qty: 500);
        var latte = await ItemSeed.Product(_db, _userId, "Latte", "LAT");
        var mocha = await ItemSeed.Product(_db, _userId, "Mocha", "MOC");
        StockSeed.Link(_db, latte.Id, item.Id, 200m);
        StockSeed.Link(_db, mocha.Id, item.Id, 150m);

        var ex = await Should.ThrowAsync<InvalidOperationException>(
            () => Handler().Handle(new DeleteItemCommand(item.Id), CancellationToken.None));

        ex.Message.ShouldContain("used by 2 product(s)");
        ex.Message.ShouldContain("Latte, Mocha");
        await using var db = TestDb.Create(_db);
        (await db.Items.SingleAsync()).IsActive.ShouldBeTrue();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
        await _alerts.DidNotReceiveWithAnyArgs().EvaluateAsync(default!, default);
    }

    [Fact]
    public async Task Handle_ManyLinkedProducts_ListsFiveAndCountsTheRest()
    {
        var item = await ItemSeed.Item(_db, _userId, name: "Cup");
        for (var i = 1; i <= 7; i++)
        {
            var product = await ItemSeed.Product(_db, _userId, $"Drink {i}", $"D{i}");
            StockSeed.Link(_db, product.Id, item.Id, 1m);
        }

        var ex = await Should.ThrowAsync<InvalidOperationException>(
            () => Handler().Handle(new DeleteItemCommand(item.Id), CancellationToken.None));

        ex.Message.ShouldContain("used by 7 product(s)");
        ex.Message.ShouldContain("and 2 more");
    }

    [Fact]
    public async Task Handle_LinksThatAreOffOrBelongToDeletedProducts_DoNotBlockTheDelete()
    {
        var item = await ItemSeed.Item(_db, _userId, name: "Oat Milk");
        var unlinked = await ItemSeed.Product(_db, _userId, "Unlinked", "UNL");
        var retired = await ItemSeed.Product(_db, _userId, "Retired", "RET");
        StockSeed.Link(_db, unlinked.Id, item.Id, 200m, active: false);
        StockSeed.Link(_db, retired.Id, item.Id, 200m);
        await using (var db = TestDb.Create(_db))
        {
            (await db.Products.SingleAsync(p => p.Id == retired.Id)).IsActive = false;
            await db.SaveChangesAsync();
        }

        var ok = await Handler().Handle(new DeleteItemCommand(item.Id), CancellationToken.None);

        ok.ShouldBeTrue();
        await using var check = TestDb.Create(_db);
        (await check.Items.SingleAsync()).IsActive.ShouldBeFalse();
    }

    [Fact]
    public async Task Handle_DeletedItem_ForgetsItsAlertLevelAndTellsTheStockScreens()
    {
        var item = await ItemSeed.Item(_db, _userId, qty: 3);
        await using (var db = TestDb.Create(_db))
        {
            (await db.Items.SingleAsync()).LastAlertStatus = 2;
            await db.SaveChangesAsync();
        }

        await Handler().Handle(new DeleteItemCommand(item.Id), CancellationToken.None);

        await using var check = TestDb.Create(_db);
        (await check.Items.SingleAsync()).LastAlertStatus.ShouldBe((byte)0);
        await _alerts.Received(1).EvaluateAsync(
            Arg.Is<IEnumerable<Guid>>(ids => ids.Single() == item.Id), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_AlreadyInactiveItem_DeletesAgainWithoutTheLinkCheck()
    {
        var item = await ItemSeed.Item(_db, _userId, active: false);
        var latte = await ItemSeed.Product(_db, _userId);
        StockSeed.Link(_db, latte.Id, item.Id, 1m);

        var ok = await Handler().Handle(new DeleteItemCommand(item.Id), CancellationToken.None);

        ok.ShouldBeTrue();
    }
}
