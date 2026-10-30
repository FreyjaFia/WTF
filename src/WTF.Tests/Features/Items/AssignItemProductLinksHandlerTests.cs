using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Items;
using WTF.Api.Features.Items.DTOs;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Items;

public class AssignItemProductLinksHandlerTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();
    private readonly IAuditService _audit = TestFakes.Audit();

    private AssignItemProductLinksHandler Handler() => new(TestDb.Create(_db), TestRequest.As(_userId), _audit);

    private static AssignItemProductLinksCommand Cmd(Guid itemId, params ProductItemLinkAssignmentDto[] links) =>
        new() { ItemId = itemId, ProductLinks = [.. links] };

    private async Task AddLink(Guid itemId, Guid productId, decimal qty, bool active)
    {
        await using var db = TestDb.Create(_db);
        db.ProductItemLinks.Add(new ProductItemLink
        {
            Id = Guid.NewGuid(),
            ItemId = itemId,
            ProductId = productId,
            QuantityPerSale = qty,
            IsActive = active,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = _userId
        });
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Handle_MissingItem_ReturnsNull() =>
        (await Handler().Handle(Cmd(Guid.NewGuid()), CancellationToken.None)).ShouldBeNull();

    [Fact]
    public async Task Handle_NewProducts_CreatesLinksAndReturnsThem()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId);
        var p1 = await ItemSeed.Product(_db, _userId, "Latte", "LAT");
        var p2 = await ItemSeed.Product(_db, _userId, "Mocha", "MOC");

        var dto = await Handler().Handle(Cmd(item.Id,
            new ProductItemLinkAssignmentDto(p1.Id, 1), new ProductItemLinkAssignmentDto(p2.Id, 0.5m, false)),
            CancellationToken.None);

        dto!.ProductLinks.Select(l => l.ProductName).ShouldBe(["Latte", "Mocha"]);
        await using var db = TestDb.Create(_db);
        (await db.ProductItemLinks.CountAsync()).ShouldBe(2);
        (await db.ProductItemLinks.SingleAsync(l => l.ProductId == p2.Id)).IsActive.ShouldBeFalse();
    }

    [Fact]
    public async Task Handle_ExistingLinkInRequest_IsUpdatedInPlace()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId);
        var p = await ItemSeed.Product(_db, _userId);
        await AddLink(item.Id, p.Id, 1, true);

        await Handler().Handle(Cmd(item.Id, new ProductItemLinkAssignmentDto(p.Id, 4, false)), CancellationToken.None);

        await using var db = TestDb.Create(_db);
        var link = await db.ProductItemLinks.SingleAsync();
        link.QuantityPerSale.ShouldBe(4m);
        link.IsActive.ShouldBeFalse();
        link.UpdatedBy.ShouldBe(_userId);
    }

    [Fact]
    public async Task Handle_LinkMissingFromRequest_IsDeactivatedNotDeleted()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId);
        var kept = await ItemSeed.Product(_db, _userId, "Keep", "K");
        var dropped = await ItemSeed.Product(_db, _userId, "Drop", "D");
        await AddLink(item.Id, kept.Id, 1, true);
        await AddLink(item.Id, dropped.Id, 1, true);

        await Handler().Handle(Cmd(item.Id, new ProductItemLinkAssignmentDto(kept.Id, 1)), CancellationToken.None);

        await using var db = TestDb.Create(_db);
        (await db.ProductItemLinks.SingleAsync(l => l.ProductId == dropped.Id)).IsActive.ShouldBeFalse();
        (await db.ProductItemLinks.SingleAsync(l => l.ProductId == kept.Id)).IsActive.ShouldBeTrue();
    }

    [Fact]
    public async Task Handle_OtherItemsLinks_AreNotTouched()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, "A");
        var other = await ItemSeed.Item(_db, _userId, "B");
        var p = await ItemSeed.Product(_db, _userId);
        await AddLink(other.Id, p.Id, 2, true);

        await Handler().Handle(Cmd(item.Id), CancellationToken.None);

        await using var db = TestDb.Create(_db);
        (await db.ProductItemLinks.SingleAsync()).IsActive.ShouldBeTrue();
    }

    [Fact]
    public async Task Handle_DuplicateProductIds_Throws()
    {
        var item = await ItemSeed.Item(_db, _userId);
        var p = await ItemSeed.Product(_db, _userId);
        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(
            Cmd(item.Id, new ProductItemLinkAssignmentDto(p.Id, 1), new ProductItemLinkAssignmentDto(p.Id, 2)),
            CancellationToken.None));
        ex.Message.ShouldBe("Duplicate product IDs are not allowed.");
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public async Task Handle_NonPositiveQuantity_Throws(int qty)
    {
        var item = await ItemSeed.Item(_db, _userId);
        var p = await ItemSeed.Product(_db, _userId);
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(item.Id, new ProductItemLinkAssignmentDto(p.Id, qty)), CancellationToken.None));
    }

    [Fact]
    public async Task Handle_UnknownProduct_ThrowsAndSavesNothing()
    {
        var item = await ItemSeed.Item(_db, _userId);
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(item.Id, new ProductItemLinkAssignmentDto(Guid.NewGuid(), 1)), CancellationToken.None));

        await using var db = TestDb.Create(_db);
        (await db.ProductItemLinks.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Handle_SavesTheAllowanceOnNewAndExistingLinks()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId);
        var latte = (await ItemSeed.Product(_db, _userId)).Id;
        var mocha = (await ItemSeed.Product(_db, _userId, "Mocha", "MOC")).Id;
        await AddLink(item.Id, mocha, 100m, true);

        await Handler().Handle(Cmd(item.Id,
            new ProductItemLinkAssignmentDto(latte, 200m, true, 5m),
            new ProductItemLinkAssignmentDto(mocha, 150m, true, 2.5m)), CancellationToken.None);

        await using var db = TestDb.Create(_db);
        var links = await db.ProductItemLinks.ToListAsync();
        links.Single(l => l.ProductId == latte).AllowancePercent.ShouldBe(5m);
        links.Single(l => l.ProductId == mocha).AllowancePercent.ShouldBe(2.5m);
    }
}
