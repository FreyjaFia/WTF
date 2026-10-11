using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Promotions;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Promotions;

public class RestorePromotionHandlerTests
{
    private readonly Guid _userId = Guid.NewGuid();
    private readonly string _dbName = TestDb.NewName();

    private RestorePromotionHandler Handler() => new(TestDb.Create(_dbName), TestRequest.As(_userId));

    [Fact]
    public async Task Handle_InactivePromotion_ReactivatesAndStampsUpdater()
    {
        Guid id;
        await using (var seed = TestDb.Create(_dbName))
            id = (await PromotionSeed.AddMixMatchAsync(seed, isActive: false)).Id;

        var ok = await Handler().Handle(new RestorePromotionCommand(id), CancellationToken.None);

        ok.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        var saved = await db.Promotions.SingleAsync();
        saved.IsActive.ShouldBeTrue();
        saved.UpdatedBy.ShouldBe(_userId);
        saved.UpdatedAt.ShouldNotBeNull();
    }

    [Fact]
    public async Task Handle_AlreadyActivePromotion_StaysActiveAndReturnsTrue()
    {
        Guid id;
        await using (var seed = TestDb.Create(_dbName))
            id = (await PromotionSeed.AddMixMatchAsync(seed, isActive: true)).Id;

        (await Handler().Handle(new RestorePromotionCommand(id), CancellationToken.None)).ShouldBeTrue();

        await using var db = TestDb.Create(_dbName);
        (await db.Promotions.SingleAsync()).IsActive.ShouldBeTrue();
    }

    [Fact]
    public async Task Handle_UnknownPromotion_ReturnsFalse()
    {
        (await Handler().Handle(new RestorePromotionCommand(Guid.NewGuid()), CancellationToken.None)).ShouldBeFalse();
    }
}
