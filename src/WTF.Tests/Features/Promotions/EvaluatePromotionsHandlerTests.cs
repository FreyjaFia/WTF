using WTF.Api.Features.Promotions;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Promotions;

public class EvaluatePromotionsHandlerTests
{
    private readonly string _dbName = TestDb.NewName();
    private readonly Guid _burger = Guid.NewGuid();
    private readonly Guid _fries = Guid.NewGuid();
    private readonly Guid _cheese = Guid.NewGuid();
    private static readonly DateTime At = PromotionSeed.Now;

    private Task<EvaluatePromotionsResponseDto> EvaluateAsync(params PromotionCartLineDto[] lines) => EvaluateAtAsync(At, null, lines);

    private async Task<EvaluatePromotionsResponseDto> EvaluateAtAsync(DateTime at, string? timeZone, params PromotionCartLineDto[] lines)
    {
        var handler = new EvaluatePromotionsHandler(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: timeZone));
        return await handler.Handle(
            new EvaluatePromotionsCommand(new EvaluatePromotionsRequestDto([.. lines], at)),
            CancellationToken.None);
    }

    private static PromotionCartLineDto Line(string id, Guid product, int qty, decimal price, params (Guid addOn, int qty)[] addOns) => new()
    {
        LineId = id,
        ProductId = product,
        Quantity = qty,
        UnitPrice = price,
        AddOns = [.. addOns.Select(a => new PromotionCartAddOnLineDto { AddOnProductId = a.addOn, Quantity = a.qty })]
    };

    [Fact]
    public async Task Handle_EmptyCart_ReturnsEmptyLines()
    {
        await using (var seed = TestDb.Create(_dbName)) await PromotionSeed.AddBundleAsync(seed, _burger, 1, 5m);

        var result = await EvaluateAsync();

        result.Lines.ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_NoPromotions_ReturnsLinesUnchanged()
    {
        var result = await EvaluateAsync(Line("a", _burger, 2, 10m));

        var line = result.Lines.Single();
        line.LineId.ShouldBe("a");
        line.Quantity.ShouldBe(2);
        line.UnitPrice.ShouldBe(10m);
        line.PromotionId.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_ZeroQuantityLines_AreDropped()
    {
        var result = await EvaluateAsync(Line("a", _burger, 0, 10m), Line("b", _fries, 1, 3m));

        result.Lines.Select(x => x.LineId).ShouldBe(["b"]);
    }

    [Fact]
    public async Task Handle_EvaluatesAtNowWhenNoTimestampGiven()
    {
        await using (var seed = TestDb.Create(_dbName))
            await PromotionSeed.AddBundleAsync(seed, _burger, 1, 5m, start: DateTime.UtcNow.AddDays(-1), end: DateTime.UtcNow.AddDays(1));

        var handler = new EvaluatePromotionsHandler(TestDb.Create(_dbName), TestRequest.None());
        var result = await handler.Handle(
            new EvaluatePromotionsCommand(new EvaluatePromotionsRequestDto([Line("a", _burger, 1, 10m)], null)),
            CancellationToken.None);

        result.Lines.ShouldContain(x => x.IsPromoLine);
    }

    [Fact]
    public async Task Handle_FixedBundleMatchingCart_ConsumesLineAndGeneratesParentAndChild()
    {
        Guid promoId;
        await using (var seed = TestDb.Create(_dbName)) promoId = (await PromotionSeed.AddBundleAsync(seed, _burger, 1, 8m)).Id;

        var result = await EvaluateAsync(Line("a", _burger, 1, 10m));

        result.Lines.Count.ShouldBe(2);
        var parent = result.Lines.Single(x => x.BundleParentId is null);
        parent.IsPromoLine.ShouldBeTrue();
        parent.IsLocked.ShouldBeTrue();
        parent.UnitPrice.ShouldBe(8m);
        parent.Quantity.ShouldBe(1);
        parent.PromotionId.ShouldBe(promoId);
        parent.TriggerLineId.ShouldBe("a");
        var child = result.Lines.Single(x => x.BundleParentId is not null);
        child.BundleParentId.ShouldBe(parent.LineId);
        child.UnitPrice.ShouldBe(0m);
        child.ProductId.ShouldBe(_burger);
        child.IsPromoLine.ShouldBeTrue();
    }

    [Fact]
    public async Task Handle_FixedBundleCartHasTwoSets_GeneratesTwoBundles()
    {
        await using (var seed = TestDb.Create(_dbName)) await PromotionSeed.AddBundleAsync(seed, _burger, 2, 15m);

        var result = await EvaluateAsync(Line("a", _burger, 5, 10m));

        result.Lines.Count(x => x.BundleParentId is null && x.IsPromoLine).ShouldBe(2);
        var remaining = result.Lines.Single(x => !x.IsPromoLine);
        remaining.Quantity.ShouldBe(1);
        remaining.UnitPrice.ShouldBe(10m);
    }

    [Fact]
    public async Task Handle_FixedBundleNotEnoughQuantity_LeavesCartAlone()
    {
        await using (var seed = TestDb.Create(_dbName)) await PromotionSeed.AddBundleAsync(seed, _burger, 3, 20m);

        var result = await EvaluateAsync(Line("a", _burger, 2, 10m));

        result.Lines.Single().Quantity.ShouldBe(2);
        result.Lines.ShouldNotContain(x => x.IsPromoLine);
    }

    [Fact]
    public async Task Handle_FixedBundleWithAddOnRequirement_RequiresAddOnOnLine()
    {
        await using (var seed = TestDb.Create(_dbName)) await PromotionSeed.AddBundleAsync(seed, _burger, 1, 8m, _cheese);

        var without = await EvaluateAsync(Line("a", _burger, 1, 10m));
        var with = await EvaluateAsync(Line("a", _burger, 1, 10m, (_cheese, 1)));

        without.Lines.ShouldNotContain(x => x.IsPromoLine);
        var child = with.Lines.Single(x => x.BundleParentId is not null);
        child.AddOns.Single().AddOnProductId.ShouldBe(_cheese);
    }

    [Fact]
    public async Task Handle_MultiItemBundle_NeedsEveryItem()
    {
        await using (var seed = TestDb.Create(_dbName))
        {
            var promo = await PromotionSeed.AddBundleAsync(seed, _burger, 1, 12m);
            seed.FixedBundlePromotionItems.Add(new()
            { Id = Guid.NewGuid(), FixedBundlePromotionId = promo.Id, ProductId = _fries, Quantity = 1 });
            await seed.SaveChangesAsync();
        }

        var partial = await EvaluateAsync(Line("a", _burger, 1, 10m));
        var full = await EvaluateAsync(Line("a", _burger, 1, 10m), Line("b", _fries, 1, 4m));

        partial.Lines.ShouldNotContain(x => x.IsPromoLine);
        full.Lines.Count.ShouldBe(3);
        full.Lines.ShouldAllBe(x => x.IsPromoLine);
        full.Lines.Select(x => x.ProductId).Order().ShouldBe(new[] { _burger, _burger, _fries }.Order());
    }

    [Fact]
    public async Task Handle_InactiveExpiredAndFuturePromotions_AreIgnored()
    {
        await using (var seed = TestDb.Create(_dbName))
        {
            await PromotionSeed.AddBundleAsync(seed, _burger, 1, 5m, isActive: false, name: "off");
            await PromotionSeed.AddBundleAsync(seed, _burger, 1, 5m, end: At.AddDays(-1), name: "expired");
            await PromotionSeed.AddBundleAsync(seed, _burger, 1, 5m, start: At.AddDays(1), name: "future");
            await PromotionSeed.AddDiscountAsync(seed, _burger, _cheese, 1, 5m, null, isActive: false);
        }

        var result = await EvaluateAsync(Line("a", _burger, 1, 10m, (_cheese, 1)));

        result.Lines.Single().UnitPrice.ShouldBe(10m);
        result.Lines.Single().PromotionId.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_PromotionOnWindowBoundaries_IsIncluded()
    {
        await using (var seed = TestDb.Create(_dbName))
            await PromotionSeed.AddBundleAsync(seed, _burger, 1, 5m, start: At, end: At);

        var result = await EvaluateAsync(Line("a", _burger, 1, 10m));

        result.Lines.ShouldContain(x => x.IsPromoLine);
    }

    [Fact]
    public async Task Handle_DiscountedProductFixedAmount_ReducesUnitPriceAndFlagsPromotion()
    {
        Guid promoId;
        await using (var seed = TestDb.Create(_dbName))
            promoId = (await PromotionSeed.AddDiscountAsync(seed, _burger, _cheese, 1, 3m, null)).Id;

        var result = await EvaluateAsync(Line("a", _burger, 2, 10m, (_cheese, 1)));

        var line = result.Lines.Single();
        line.UnitPrice.ShouldBe(7m);
        line.Quantity.ShouldBe(2);
        line.PromotionId.ShouldBe(promoId);
    }

    [Fact]
    public async Task Handle_DiscountedProductPercent_RoundsToCents()
    {
        await using (var seed = TestDb.Create(_dbName))
            await PromotionSeed.AddDiscountAsync(seed, _burger, _cheese, 1, null, 15m);

        var result = await EvaluateAsync(Line("a", _burger, 1, 9.99m, (_cheese, 1)));

        result.Lines.Single().UnitPrice.ShouldBe(8.49m);
    }

    [Fact]
    public async Task Handle_DiscountedProductFixedAboveBase_ClampsToZero()
    {
        await using (var seed = TestDb.Create(_dbName))
            await PromotionSeed.AddDiscountAsync(seed, _burger, _cheese, 1, 50m, null);

        var result = await EvaluateAsync(Line("a", _burger, 1, 10m, (_cheese, 1)));

        result.Lines.Single().UnitPrice.ShouldBe(0m);
    }

    [Fact]
    public async Task Handle_DiscountedProductAddOnsDoNotMatchExactly_NoDiscount()
    {
        await using (var seed = TestDb.Create(_dbName))
            await PromotionSeed.AddDiscountAsync(seed, _burger, _cheese, 1, 3m, null);

        var missing = await EvaluateAsync(Line("a", _burger, 1, 10m));
        var wrongQty = await EvaluateAsync(Line("a", _burger, 1, 10m, (_cheese, 2)));
        var extra = await EvaluateAsync(Line("a", _burger, 1, 10m, (_cheese, 1), (Guid.NewGuid(), 1)));

        missing.Lines.Single().UnitPrice.ShouldBe(10m);
        wrongQty.Lines.Single().UnitPrice.ShouldBe(10m);
        extra.Lines.Single().UnitPrice.ShouldBe(10m);
    }

    [Fact]
    public async Task Handle_TwoDiscountsForSameProduct_PicksLowestPrice()
    {
        Guid better;
        await using (var seed = TestDb.Create(_dbName))
        {
            await PromotionSeed.AddDiscountAsync(seed, _burger, _cheese, 1, 2m, null, name: "small");
            better = (await PromotionSeed.AddDiscountAsync(seed, _burger, _cheese, 1, null, 50m, name: "big")).Id;
        }

        var result = await EvaluateAsync(Line("a", _burger, 1, 10m, (_cheese, 1)));

        result.Lines.Single().UnitPrice.ShouldBe(5m);
        result.Lines.Single().PromotionId.ShouldBe(better);
    }

    [Fact]
    public async Task Handle_IncomingPromoLines_AreDroppedAndNotKept()
    {
        await using (var seed = TestDb.Create(_dbName)) await PromotionSeed.AddBundleAsync(seed, _burger, 1, 8m);
        var oldPromo = Line("old", _burger, 1, 8m);
        oldPromo.IsPromoLine = true;

        var result = await EvaluateAsync(oldPromo, Line("a", _burger, 1, 10m));

        result.Lines.ShouldNotContain(x => x.LineId == "old");
        result.Lines.Count(x => x.BundleParentId is null && x.IsPromoLine).ShouldBe(1);
    }

    [Fact]
    public async Task Handle_FreeItemLine_IsNotUsedToFormBundle()
    {
        await using (var seed = TestDb.Create(_dbName)) await PromotionSeed.AddBundleAsync(seed, _burger, 1, 8m);
        var free = Line("free", _burger, 1, 0m);
        free.IsFreeItem = true;

        var result = await EvaluateAsync(free);

        result.Lines.ShouldNotContain(x => x.IsPromoLine);
        result.Lines.Single().IsFreeItem.ShouldBeTrue();
    }

    [Fact]
    public async Task Handle_LockedLine_IsNotDiscountedAgain()
    {
        await using (var seed = TestDb.Create(_dbName))
            await PromotionSeed.AddDiscountAsync(seed, _burger, _cheese, 1, 3m, null);
        var locked = Line("lock", _burger, 1, 7m, (_cheese, 1));
        locked.IsLocked = true;

        var result = await EvaluateAsync(locked);

        result.Lines.Single().UnitPrice.ShouldBe(7m);
    }

    // The promotion editor saves an end date as the local midnight that starts that day, so an exact-instant
    // comparison would switch the promotion off the moment its last day began. It must run through that whole day,
    // the same rule the order is saved with.
    [Fact]
    public async Task Handle_PromotionOnItsLastLocalDay_StillAppliesLateInTheDay()
    {
        var endMidnightInManila = new DateTime(2026, 6, 14, 16, 0, 0, DateTimeKind.Utc); // 15 Jun 00:00 in UTC+8
        await using (var seed = TestDb.Create(_dbName))
            await PromotionSeed.AddDiscountAsync(seed, _burger, _cheese, 1, 3m, null, end: endMidnightInManila);

        var result = await EvaluateAtAsync(At, "Asia/Manila", Line("a", _burger, 1, 10m, (_cheese, 1))); // 20:00 on 15 Jun

        result.Lines.Single().UnitPrice.ShouldBe(7m);
    }

    [Fact]
    public async Task Handle_PromotionAfterItsLastLocalDay_NoLongerApplies()
    {
        var endMidnightInManila = new DateTime(2026, 6, 14, 16, 0, 0, DateTimeKind.Utc);
        await using (var seed = TestDb.Create(_dbName))
            await PromotionSeed.AddDiscountAsync(seed, _burger, _cheese, 1, 3m, null, end: endMidnightInManila);

        var nextDayInManila = new DateTime(2026, 6, 15, 16, 0, 0, DateTimeKind.Utc); // 16 Jun 00:00 in UTC+8
        var result = await EvaluateAtAsync(nextDayInManila, "Asia/Manila", Line("a", _burger, 1, 10m, (_cheese, 1)));

        result.Lines.Single().UnitPrice.ShouldBe(10m);
    }

    [Fact]
    public async Task Handle_PromotionNotStartedOnTheLocalDay_DoesNotApply()
    {
        var startMidnightInManila = new DateTime(2026, 6, 15, 16, 0, 0, DateTimeKind.Utc); // 16 Jun 00:00 in UTC+8
        await using (var seed = TestDb.Create(_dbName))
            await PromotionSeed.AddDiscountAsync(seed, _burger, _cheese, 1, 3m, null, start: startMidnightInManila);

        var result = await EvaluateAtAsync(At, "Asia/Manila", Line("a", _burger, 1, 10m, (_cheese, 1))); // still 15 Jun

        result.Lines.Single().UnitPrice.ShouldBe(10m);
    }

    [Fact]
    public async Task Handle_InputLines_AreNotMutated()
    {
        await using (var seed = TestDb.Create(_dbName)) await PromotionSeed.AddBundleAsync(seed, _burger, 1, 8m);
        var input = Line("a", _burger, 1, 10m);

        await EvaluateAsync(input);

        input.Quantity.ShouldBe(1);
        input.UnitPrice.ShouldBe(10m);
    }
}
