using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Items;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Items;

public class LinkProductItemHandlerTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();
    private readonly IAuditService _audit = TestFakes.Audit();

    private LinkProductItemHandler Handler() => new(TestDb.Create(_db), TestRequest.As(_userId), _audit);

    [Fact]
    public async Task Handle_NewLink_IsCreatedActive()
    {
        var item = await ItemSeed.Item(_db, _userId);
        var product = await ItemSeed.Product(_db, _userId);

        var dto = await Handler().Handle(
            new LinkProductItemCommand { ItemId = item.Id, ProductId = product.Id, QuantityPerSale = 0.5m }, CancellationToken.None);

        dto.IsActive.ShouldBeTrue();
        dto.QuantityPerSale.ShouldBe(0.5m);
        dto.ProductName.ShouldBe("Latte");
        await using var db = TestDb.Create(_db);
        var link = await db.ProductItemLinks.SingleAsync();
        link.CreatedBy.ShouldBe(_userId);
        await _audit.Received(1).LogAsync(AuditAction.ProductItemLinked, AuditEntityType.ProductItemLink, link.Id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_ExistingInactiveLink_IsReactivatedAndUpdatedNotDuplicated()
    {
        var item = await ItemSeed.Item(_db, _userId);
        var product = await ItemSeed.Product(_db, _userId);
        await using (var db = TestDb.Create(_db))
        {
            db.ProductItemLinks.Add(new ProductItemLink
            {
                Id = Guid.NewGuid(),
                ItemId = item.Id,
                ProductId = product.Id,
                QuantityPerSale = 1,
                IsActive = false,
                CreatedAt = DateTime.UtcNow,
                CreatedBy = _userId
            });
            await db.SaveChangesAsync();
        }

        await Handler().Handle(
            new LinkProductItemCommand { ItemId = item.Id, ProductId = product.Id, QuantityPerSale = 3 }, CancellationToken.None);

        await using var check = TestDb.Create(_db);
        var link = await check.ProductItemLinks.SingleAsync();
        link.IsActive.ShouldBeTrue();
        link.QuantityPerSale.ShouldBe(3m);
        link.UpdatedBy.ShouldBe(_userId);
    }

    [Fact]
    public async Task Handle_MissingProduct_Throws()
    {
        var item = await ItemSeed.Item(_db, _userId);
        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(
            new LinkProductItemCommand { ItemId = item.Id, ProductId = Guid.NewGuid() }, CancellationToken.None));
        ex.Message.ShouldBe("Product not found.");
    }

    [Fact]
    public async Task Handle_MissingItem_Throws()
    {
        var product = await ItemSeed.Product(_db, _userId);
        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(
            new LinkProductItemCommand { ItemId = Guid.NewGuid(), ProductId = product.Id }, CancellationToken.None));
        ex.Message.ShouldBe("Item not found.");
    }
}
