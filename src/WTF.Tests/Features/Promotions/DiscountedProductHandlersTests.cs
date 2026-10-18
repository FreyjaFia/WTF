using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Promotions;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Promotions;

public class DiscountedProductHandlersTests : IAsyncLifetime
{
    private readonly Guid _userId = Guid.NewGuid();
    private readonly string _dbName = TestDb.NewName();
    private readonly Guid _burger = Guid.NewGuid();
    private readonly Guid _fries = Guid.NewGuid();
    private readonly Guid _cheese = Guid.NewGuid();
    private readonly Guid _bacon = Guid.NewGuid();

    public async Task InitializeAsync()
    {
        await using var db = TestDb.Create(_dbName);
        await PromotionSeed.SeedProductsAsync(
            db, _userId, (_burger, "Burger", false), (_fries, "Fries", false), (_cheese, "Cheese", true), (_bacon, "Bacon", true));
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Create_InactiveProduct_ThrowsNamingIt()
    {
        await LinkAsync(_burger, _cheese);
        await using (var db = TestDb.Create(_dbName))
        {
            (await db.Products.SingleAsync(x => x.Id == _burger)).IsActive = false;
            await db.SaveChangesAsync();
        }

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(Item(_burger, 5m, null, _cheese)), CancellationToken.None));

        ex.Message.ShouldBe("Inactive products cannot be used in a promotion: Burger.");
    }

    [Fact]
    public async Task Create_UnknownProduct_ThrowsAClearError()
    {
        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(Item(Guid.NewGuid(), 5m, null, _cheese)), CancellationToken.None));

        ex.Message.ShouldBe("One or more promotion products or add-ons do not exist.");
    }

    [Fact]
    public async Task Create_NameLongerThan100_Throws()
    {
        await LinkAsync(_burger, _cheese);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(Item(_burger, 5m, null, _cheese)) with { Name = new string('x', 101) }, CancellationToken.None));

        ex.Message.ShouldBe("Promotion name must be 100 characters or fewer.");
    }

    private CreateDiscountedProductPromotionHandler Create() => new(TestDb.Create(_dbName), TestRequest.As(_userId));
    private UpdateDiscountedProductPromotionHandler Update() => new(TestDb.Create(_dbName), TestRequest.As(_userId));

    private static CreateDiscountedProductItemRequestDto Item(Guid product, decimal? fixedPrice, decimal? percent, params Guid[] addOns) =>
        new(product, fixedPrice, percent, [.. addOns.Select(a => new CreateDiscountedProductAddOnRequestDto(a, 1))]);

    private static CreateDiscountedProductPromotionCommand Cmd(params CreateDiscountedProductItemRequestDto[] items) =>
        new() { Name = " Happy hour ", Items = [.. items] };

    private async Task LinkAsync(Guid product, Guid addOn, bool active = true)
    {
        await using var db = TestDb.Create(_dbName);
        await PromotionSeed.LinkAddOnAsync(db, product, addOn, active);
    }

    [Fact]
    public async Task Create_ValidPromotion_SavesItemsAndAddOns()
    {
        await LinkAsync(_burger, _cheese);

        var dto = await Create().Handle(Cmd(Item(_burger, null, 20m, _cheese)), CancellationToken.None);

        dto.Name.ShouldBe("Happy hour");
        dto.Items.Single().PercentOff.ShouldBe(20m);
        await using var db = TestDb.Create(_dbName);
        var saved = await db.Promotions.Include(x => x.DiscountedProductPromotions)
            .ThenInclude(x => x.DiscountedProductPromotionAddOns).SingleAsync();
        saved.TypeId.ShouldBe(PromotionTypeIds.DiscountedProduct);
        saved.CreatedBy.ShouldBe(_userId);
        saved.IsActive.ShouldBeTrue();
        var item = saved.DiscountedProductPromotions.Single();
        item.ProductId.ShouldBe(_burger);
        item.FixedPrice.ShouldBeNull();
        item.DiscountedProductPromotionAddOns.Single().AddOnProductId.ShouldBe(_cheese);
    }

    [Fact]
    public async Task Create_InactiveWithDates_KeepsFlagAndDates()
    {
        await LinkAsync(_burger, _cheese);
        var cmd = Cmd(Item(_burger, 5m, null, _cheese)) with
        {
            IsActive = false,
            StartDate = PromotionSeed.Now,
            EndDate = PromotionSeed.Now.AddDays(3)
        };

        await Create().Handle(cmd, CancellationToken.None);

        await using var db = TestDb.Create(_dbName);
        var saved = await db.Promotions.SingleAsync();
        saved.IsActive.ShouldBeFalse();
        saved.StartDate.ShouldBe(PromotionSeed.Now);
        saved.EndDate.ShouldBe(PromotionSeed.Now.AddDays(3));
    }

    [Fact]
    public async Task Create_BlankName_ThrowsAndSavesNothing()
    {
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(Item(_burger, 5m, null, _cheese)) with { Name = " " }, CancellationToken.None));

        await using var db = TestDb.Create(_dbName);
        (await db.Promotions.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Create_BothFixedAndPercent_Throws()
    {
        await LinkAsync(_burger, _cheese);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(Item(_burger, 5m, 10m, _cheese)), CancellationToken.None));
    }

    [Fact]
    public async Task Create_NeitherFixedNorPercent_Throws()
    {
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(Item(_burger, null, null, _cheese)), CancellationToken.None));
    }

    [Fact]
    public async Task Create_PercentOver100_Throws()
    {
        await LinkAsync(_burger, _cheese);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(Item(_burger, null, 101m, _cheese)), CancellationToken.None));
    }

    [Fact]
    public async Task Create_NoAddOns_ThrowsRequiredAddOnMessage()
    {
        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(Item(_burger, 5m, null)), CancellationToken.None));

        ex.Message.ShouldContain("at least one required add-on");
    }

    [Fact]
    public async Task Create_DuplicateProducts_Throws()
    {
        await LinkAsync(_burger, _cheese);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(Item(_burger, 5m, null, _cheese), Item(_burger, 6m, null, _cheese)), CancellationToken.None));
    }

    [Fact]
    public async Task Create_UnlinkedAddOn_ThrowsAndSavesNothing()
    {
        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(Item(_burger, 5m, null, _cheese)), CancellationToken.None));

        ex.Message.ShouldContain("not linked");
        await using var db = TestDb.Create(_dbName);
        (await db.Promotions.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Create_InactiveLink_Throws()
    {
        await LinkAsync(_burger, _cheese, active: false);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(Item(_burger, 5m, null, _cheese)), CancellationToken.None));
    }

    [Fact]
    public async Task Create_SeveralAddOnsOneUnlinked_Throws()
    {
        await LinkAsync(_burger, _cheese);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(Item(_burger, 5m, null, _cheese, _bacon)), CancellationToken.None));
    }

    [Fact]
    public async Task Create_SeveralAddOnsAllLinked_Succeeds()
    {
        await LinkAsync(_burger, _cheese);
        await LinkAsync(_burger, _bacon);

        var dto = await Create().Handle(Cmd(Item(_burger, 5m, null, _cheese, _bacon)), CancellationToken.None);

        dto.Items.Single().AddOns.Count.ShouldBe(2);
    }

    [Fact]
    public async Task Create_EachItemChecksItsOwnLinks()
    {
        await LinkAsync(_burger, _cheese);

        // fries has no link to cheese even though burger does
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(Item(_burger, 5m, null, _cheese), Item(_fries, 5m, null, _cheese)), CancellationToken.None));
    }

    [Fact]
    public async Task Update_ExistingPromotion_RebuildsItems()
    {
        await LinkAsync(_fries, _bacon);
        Guid id;
        await using (var seed = TestDb.Create(_dbName))
            id = (await PromotionSeed.AddDiscountAsync(seed, _burger, _cheese, 1, 5m, null)).Id;
        var cmd = new UpdateDiscountedProductPromotionCommand
        {
            PromotionId = id,
            Name = " Renamed ",
            IsActive = false,
            Items = [Item(_fries, null, 15m, _bacon)]
        };

        var dto = await Update().Handle(cmd, CancellationToken.None);

        dto.ShouldNotBeNull();
        dto.Items.Single().ProductId.ShouldBe(_fries);
        await using var db = TestDb.Create(_dbName);
        var saved = await db.Promotions.Include(x => x.DiscountedProductPromotions)
            .ThenInclude(x => x.DiscountedProductPromotionAddOns).SingleAsync();
        saved.Name.ShouldBe("Renamed");
        saved.IsActive.ShouldBeFalse();
        saved.UpdatedBy.ShouldBe(_userId);
        saved.DiscountedProductPromotions.Single().PercentOff.ShouldBe(15m);
        (await db.DiscountedProductPromotions.CountAsync()).ShouldBe(1);
        (await db.DiscountedProductPromotionAddOns.CountAsync()).ShouldBe(1);
        (await db.DiscountedProductPromotionAddOns.SingleAsync()).AddOnProductId.ShouldBe(_bacon);
    }

    [Fact]
    public async Task Update_UnknownPromotion_ReturnsNull()
    {
        await LinkAsync(_burger, _cheese);
        var cmd = new UpdateDiscountedProductPromotionCommand
        { PromotionId = Guid.NewGuid(), Name = "x", Items = [Item(_burger, 5m, null, _cheese)] };

        (await Update().Handle(cmd, CancellationToken.None)).ShouldBeNull();
    }

    [Fact]
    public async Task Update_UnlinkedAddOn_ThrowsAndKeepsOldItems()
    {
        Guid id;
        await using (var seed = TestDb.Create(_dbName))
            id = (await PromotionSeed.AddDiscountAsync(seed, _burger, _cheese, 1, 5m, null)).Id;
        var cmd = new UpdateDiscountedProductPromotionCommand
        { PromotionId = id, Name = "x", Items = [Item(_burger, 5m, null, _bacon)] };

        await Should.ThrowAsync<InvalidOperationException>(() => Update().Handle(cmd, CancellationToken.None));

        await using var db = TestDb.Create(_dbName);
        (await db.DiscountedProductPromotionAddOns.SingleAsync()).AddOnProductId.ShouldBe(_cheese);
    }

    [Fact]
    public async Task Delete_ExistingPromotion_SoftDeletes()
    {
        Guid id;
        await using (var seed = TestDb.Create(_dbName))
            id = (await PromotionSeed.AddDiscountAsync(seed, _burger, _cheese, 1, 5m, null)).Id;

        var ok = await new DeleteDiscountedProductPromotionHandler(TestDb.Create(_dbName), TestRequest.As(_userId))
            .Handle(new DeleteDiscountedProductPromotionCommand(id), CancellationToken.None);

        ok.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        var saved = await db.Promotions.SingleAsync();
        saved.IsActive.ShouldBeFalse();
        saved.UpdatedBy.ShouldBe(_userId);
        (await db.DiscountedProductPromotions.CountAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task Delete_UnknownOrOtherType_ReturnsFalse()
    {
        Guid bundleId;
        await using (var seed = TestDb.Create(_dbName))
            bundleId = (await PromotionSeed.AddBundleAsync(seed, _burger, 1, 5m)).Id;
        var handler = new DeleteDiscountedProductPromotionHandler(TestDb.Create(_dbName), TestRequest.As(_userId));

        (await handler.Handle(new DeleteDiscountedProductPromotionCommand(Guid.NewGuid()), CancellationToken.None)).ShouldBeFalse();
        (await handler.Handle(new DeleteDiscountedProductPromotionCommand(bundleId), CancellationToken.None)).ShouldBeFalse();
    }

    [Fact]
    public async Task GetById_ExistingAndMissing_ReturnsDtoOrNull()
    {
        Guid id;
        await using (var seed = TestDb.Create(_dbName))
            id = (await PromotionSeed.AddDiscountAsync(seed, _burger, _cheese, 2, 5m, null)).Id;
        var handler = new GetDiscountedProductPromotionByIdHandler(TestDb.Create(_dbName), TestRequest.As(_userId));

        var dto = await handler.Handle(new GetDiscountedProductPromotionByIdQuery(id), CancellationToken.None);
        var missing = await handler.Handle(new GetDiscountedProductPromotionByIdQuery(Guid.NewGuid()), CancellationToken.None);

        dto.ShouldNotBeNull();
        dto.Items.Single().AddOns.Single().Quantity.ShouldBe(2);
        missing.ShouldBeNull();
    }

    [Fact]
    public async Task List_ReturnsOnlyDiscountedActiveFirstWithPrices()
    {
        await using (var seed = TestDb.Create(_dbName))
        {
            await PromotionSeed.AddDiscountAsync(seed, _burger, _cheese, 1, 5m, null, isActive: false, name: "A off");
            await PromotionSeed.AddDiscountAsync(seed, _fries, _cheese, 1, null, 10m, name: "B on");
            await PromotionSeed.AddBundleAsync(seed, _burger, 1, 9m);
        }

        var list = await new GetDiscountedProductPromotionsHandler(TestDb.Create(_dbName), TestRequest.As(_userId))
            .Handle(new GetDiscountedProductPromotionsQuery(), CancellationToken.None);

        list.Select(x => x.Name).ShouldBe(["B on", "A off"]);
        list[0].PercentOff.ShouldBe(10m);
        list[1].FixedPrice.ShouldBe(5m);
    }

    [Fact]
    public async Task GetActive_FiltersByActiveFlagAndDateWindow()
    {
        var at = PromotionSeed.Now;
        await using (var seed = TestDb.Create(_dbName))
        {
            await PromotionSeed.AddDiscountAsync(seed, _burger, _cheese, 1, 5m, null, name: "open ended");
            await PromotionSeed.AddDiscountAsync(seed, _burger, _cheese, 1, 5m, null, start: at.AddDays(-1), end: at.AddDays(1), name: "in window");
            await PromotionSeed.AddDiscountAsync(seed, _burger, _cheese, 1, 5m, null, start: at.AddDays(1), name: "future");
            await PromotionSeed.AddDiscountAsync(seed, _burger, _cheese, 1, 5m, null, end: at.AddDays(-1), name: "expired");
            await PromotionSeed.AddDiscountAsync(seed, _burger, _cheese, 1, 5m, null, isActive: false, name: "inactive");
        }

        var list = await new GetActiveDiscountedProductPromotionsHandler(TestDb.Create(_dbName), TestRequest.As(_userId))
            .Handle(new GetActiveDiscountedProductPromotionsQuery(at), CancellationToken.None);

        list.Select(x => x.Name).ShouldBe(["in window", "open ended"]);
    }
}
