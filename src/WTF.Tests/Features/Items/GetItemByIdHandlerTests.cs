using WTF.Api.Features.Items;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Items;

public class GetItemByIdHandlerTests
{
    private readonly string _db = TestDb.NewName();

    [Fact]
    public async Task Handle_MissingItem_ReturnsNull()
    {
        var r = await new GetItemByIdHandler(TestDb.Create(_db)).Handle(new GetItemByIdQuery(Guid.NewGuid()), CancellationToken.None);
        r.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_ItemWithHistoryAndMovements_MapsNewestFirstWithUserNames()
    {
        var user = await ItemSeed.User(_db, first: "Ana", last: "Cruz");
        var item = await ItemSeed.Item(_db, user.Id, qty: 5, cost: 3);
        var t = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        await using (var db = TestDb.Create(_db))
        {
            db.ItemPriceHistories.AddRange(
                new ItemPriceHistory { Id = Guid.NewGuid(), ItemId = item.Id, OldPrice = null, NewPrice = 2, UpdatedAt = t, UpdatedBy = user.Id },
                new ItemPriceHistory { Id = Guid.NewGuid(), ItemId = item.Id, OldPrice = 2, NewPrice = 3, UpdatedAt = t.AddDays(1), UpdatedBy = user.Id });
            for (var i = 0; i < 30; i++)
            {
                db.StockMovements.Add(new StockMovement
                {
                    Id = Guid.NewGuid(), ItemId = item.Id, MovementType = "AddStock", QuantityDelta = 1,
                    QuantityBefore = i, QuantityAfter = i + 1, CreatedAt = t.AddMinutes(i), CreatedBy = user.Id
                });
            }
            await db.SaveChangesAsync();
        }

        var dto = await new GetItemByIdHandler(TestDb.Create(_db)).Handle(new GetItemByIdQuery(item.Id), CancellationToken.None);

        dto!.PriceHistory.Select(h => h.NewPrice).ShouldBe([3m, 2m]);
        dto.PriceHistory[0].UpdatedByName.ShouldBe("Ana Cruz");
        dto.RecentMovements.Count.ShouldBe(25); // capped
        dto.RecentMovements[0].QuantityAfter.ShouldBe(30m); // newest first
        dto.RecentMovements[0].CreatedByName.ShouldBe("Ana Cruz");
    }
}
