using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Promotions;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Promotions;

public class MixMatchHandlersTests : IAsyncLifetime
{
    private readonly Guid _userId = Guid.NewGuid();
    private readonly string _dbName = TestDb.NewName();
    private readonly Guid _coffee = Guid.NewGuid();
    private readonly Guid _tea = Guid.NewGuid();
    private readonly Guid _milk = Guid.NewGuid();
    private readonly Guid _sugar = Guid.NewGuid();

    public async Task InitializeAsync()
    {
        await using var db = TestDb.Create(_dbName);
        await PromotionSeed.SeedProductsAsync(
            db, _userId, (_coffee, "Coffee", false), (_tea, "Tea", false), (_milk, "Milk", true), (_sugar, "Sugar", true));
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Create_UnknownProduct_ThrowsAClearErrorAndSavesNothing()
    {
        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(Item(Guid.NewGuid())), CancellationToken.None));

        ex.Message.ShouldBe("One or more promotion products or add-ons do not exist.");
        await using var db = TestDb.Create(_dbName);
        (await db.Promotions.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Create_InactiveProduct_ThrowsNamingIt()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            (await db.Products.SingleAsync(x => x.Id == _tea)).IsActive = false;
            await db.SaveChangesAsync();
        }

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(Item(_coffee), Item(_tea)), CancellationToken.None));

        ex.Message.ShouldBe("Inactive products cannot be used in a promotion: Tea.");
    }

    [Fact]
    public async Task Create_NameLongerThan100_Throws()
    {
        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(Item(_coffee)) with { Name = new string('x', 101) }, CancellationToken.None));

        ex.Message.ShouldBe("Promotion name must be 100 characters or fewer.");
    }

    private CreateMixMatchPromotionHandler Create() => new(TestDb.Create(_dbName), TestRequest.As(_userId));
    private UpdateMixMatchPromotionHandler Update() => new(TestDb.Create(_dbName), TestRequest.As(_userId));

    private static CreateMixMatchPromotionCommand Cmd(params CreateMixMatchItemRequestDto[] items) => new()
    {
        Name = " Any 2 ",
        RequiredQuantity = 2,
        BundlePrice = 15m,
        MaxSelectionsPerOrder = 3,
        Items = [.. items]
    };

    private static CreateMixMatchItemRequestDto Item(Guid product, params Guid[] addOns) =>
        new(product, [.. addOns.Select(a => new CreateMixMatchItemAddOnRequestDto(a, 1))]);

    [Fact]
    public async Task Create_ValidPromotion_SavesRulesAndProducts()
    {
        var dto = await Create().Handle(Cmd(Item(_coffee), Item(_tea)), CancellationToken.None);

        dto.Name.ShouldBe("Any 2");
        dto.Items.Count.ShouldBe(2);
        await using var db = TestDb.Create(_dbName);
        var saved = await db.Promotions.Include(x => x.MixMatchPromotion!)
            .ThenInclude(x => x.MixMatchPromotionProducts).SingleAsync();
        saved.TypeId.ShouldBe(PromotionTypeIds.MixMatch);
        saved.CreatedBy.ShouldBe(_userId);
        saved.MixMatchPromotion!.RequiredQuantity.ShouldBe(2);
        saved.MixMatchPromotion.MaxSelectionsPerOrder.ShouldBe(3);
        saved.MixMatchPromotion.BundlePrice.ShouldBe(15m);
        saved.MixMatchPromotion.MixMatchPromotionProducts.Count.ShouldBe(2);
    }

    [Fact]
    public async Task Create_LinkedAddOn_SavesAddOn()
    {
        await using (var seed = TestDb.Create(_dbName))
            await PromotionSeed.LinkAddOnAsync(seed, _coffee, _milk);

        var dto = await Create().Handle(Cmd(Item(_coffee, _milk)), CancellationToken.None);

        dto.Items.Single().AddOns.Single().AddOnProductId.ShouldBe(_milk);
    }

    [Fact]
    public async Task Create_UnlinkedAddOn_ThrowsAndSavesNothing()
    {
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(Item(_coffee, _milk)), CancellationToken.None));

        await using var db = TestDb.Create(_dbName);
        (await db.Promotions.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Create_InactiveLink_Throws()
    {
        await using (var seed = TestDb.Create(_dbName))
            await PromotionSeed.LinkAddOnAsync(seed, _coffee, _milk, isActive: false);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(Item(_coffee, _milk)), CancellationToken.None));
    }

    [Fact]
    public async Task Create_SeveralAddOnsOneUnlinked_Throws()
    {
        await using (var seed = TestDb.Create(_dbName))
            await PromotionSeed.LinkAddOnAsync(seed, _coffee, _milk);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(Item(_coffee, _milk, _sugar)), CancellationToken.None));
    }

    [Fact]
    public async Task Create_SeveralAddOnsAllLinked_Succeeds()
    {
        await using (var seed = TestDb.Create(_dbName))
        {
            await PromotionSeed.LinkAddOnAsync(seed, _coffee, _milk);
            await PromotionSeed.LinkAddOnAsync(seed, _coffee, _sugar);
        }

        var dto = await Create().Handle(Cmd(Item(_coffee, _milk, _sugar)), CancellationToken.None);

        dto.Items.Single().AddOns.Count.ShouldBe(2);
    }

    [Fact]
    public async Task Create_AddOnLinkedOnlyToAnotherItem_Throws()
    {
        await using (var seed = TestDb.Create(_dbName))
            await PromotionSeed.LinkAddOnAsync(seed, _tea, _milk);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(Item(_coffee, _milk), Item(_tea)), CancellationToken.None));
    }

    [Fact]
    public async Task Create_DuplicateProducts_Throws()
    {
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(Item(_coffee), Item(_coffee)), CancellationToken.None));
    }

    [Fact]
    public async Task Create_ZeroRequiredQuantity_Throws()
    {
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(Item(_coffee)) with { RequiredQuantity = 0 }, CancellationToken.None));
    }

    [Fact]
    public async Task Create_NegativeBundlePrice_Throws()
    {
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(Item(_coffee)) with { BundlePrice = -1m }, CancellationToken.None));
    }

    [Fact]
    public async Task Create_NoItems_Throws()
    {
        await Should.ThrowAsync<InvalidOperationException>(() => Create().Handle(Cmd(), CancellationToken.None));
    }

    [Fact]
    public async Task Create_InactiveWithDates_KeepsFlagAndDates()
    {
        var cmd = Cmd(Item(_coffee)) with
        {
            IsActive = false,
            StartDate = PromotionSeed.Now,
            EndDate = PromotionSeed.Now.AddDays(2)
        };

        var dto = await Create().Handle(cmd, CancellationToken.None);

        dto.IsActive.ShouldBeFalse();
        dto.StartDate.ShouldBe(PromotionSeed.Now);
        dto.EndDate.ShouldBe(PromotionSeed.Now.AddDays(2));
    }

    [Fact]
    public async Task Update_ExistingPromotion_RebuildsProductsAndRules()
    {
        Guid id;
        await using (var seed = TestDb.Create(_dbName))
            id = (await PromotionSeed.AddMixMatchAsync(seed)).Id;
        var cmd = new UpdateMixMatchPromotionCommand
        {
            PromotionId = id,
            Name = "Renamed",
            RequiredQuantity = 4,
            BundlePrice = 22m,
            IsActive = false,
            Items = [Item(_coffee), Item(_tea)]
        };

        var dto = await Update().Handle(cmd, CancellationToken.None);

        dto.ShouldNotBeNull();
        dto.RequiredQuantity.ShouldBe(4);
        await using var db = TestDb.Create(_dbName);
        var saved = await db.Promotions.Include(x => x.MixMatchPromotion!)
            .ThenInclude(x => x.MixMatchPromotionProducts).SingleAsync();
        saved.Name.ShouldBe("Renamed");
        saved.IsActive.ShouldBeFalse();
        saved.UpdatedBy.ShouldBe(_userId);
        saved.MixMatchPromotion!.BundlePrice.ShouldBe(22m);
        saved.MixMatchPromotion.MixMatchPromotionProducts.Select(x => x.ProductId)
            .ShouldBe([_coffee, _tea], ignoreOrder: true);
        (await db.MixMatchPromotionProducts.CountAsync()).ShouldBe(2);
    }

    [Fact]
    public async Task Update_UnknownPromotion_ReturnsNull()
    {
        var cmd = new UpdateMixMatchPromotionCommand
        { PromotionId = Guid.NewGuid(), Name = "x", RequiredQuantity = 1, Items = [Item(_coffee)] };

        (await Update().Handle(cmd, CancellationToken.None)).ShouldBeNull();
    }

    [Fact]
    public async Task Update_UnlinkedAddOn_Throws()
    {
        Guid id;
        await using (var seed = TestDb.Create(_dbName))
            id = (await PromotionSeed.AddMixMatchAsync(seed)).Id;
        var cmd = new UpdateMixMatchPromotionCommand
        { PromotionId = id, Name = "x", RequiredQuantity = 1, Items = [Item(_coffee, _milk)] };

        await Should.ThrowAsync<InvalidOperationException>(() => Update().Handle(cmd, CancellationToken.None));
    }

    [Fact]
    public async Task Delete_ExistingPromotion_SoftDeletes()
    {
        Guid id;
        await using (var seed = TestDb.Create(_dbName))
            id = (await PromotionSeed.AddMixMatchAsync(seed)).Id;

        var ok = await new DeleteMixMatchPromotionHandler(TestDb.Create(_dbName), TestRequest.As(_userId))
            .Handle(new DeleteMixMatchPromotionCommand(id), CancellationToken.None);

        ok.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        (await db.Promotions.SingleAsync()).IsActive.ShouldBeFalse();
        (await db.MixMatchPromotionProducts.CountAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task Delete_UnknownPromotion_ReturnsFalse()
    {
        var ok = await new DeleteMixMatchPromotionHandler(TestDb.Create(_dbName), TestRequest.As(_userId))
            .Handle(new DeleteMixMatchPromotionCommand(Guid.NewGuid()), CancellationToken.None);

        ok.ShouldBeFalse();
    }

    [Fact]
    public async Task GetById_ExistingAndMissing_ReturnsDtoOrNull()
    {
        Guid id;
        await using (var seed = TestDb.Create(_dbName))
            id = (await PromotionSeed.AddMixMatchAsync(seed)).Id;
        var handler = new GetMixMatchPromotionByIdHandler(TestDb.Create(_dbName), TestRequest.As(_userId));

        var dto = await handler.Handle(new GetMixMatchPromotionByIdQuery(id), CancellationToken.None);
        var missing = await handler.Handle(new GetMixMatchPromotionByIdQuery(Guid.NewGuid()), CancellationToken.None);

        dto.ShouldNotBeNull();
        dto.RequiredQuantity.ShouldBe(2);
        missing.ShouldBeNull();
    }

    [Fact]
    public async Task List_MixedPromotions_ReturnsOnlyMixMatchActiveFirst()
    {
        await using (var seed = TestDb.Create(_dbName))
        {
            await PromotionSeed.AddMixMatchAsync(seed, "B", isActive: false);
            await PromotionSeed.AddMixMatchAsync(seed, "Z");
            await PromotionSeed.AddMixMatchAsync(seed, "A");
            await PromotionSeed.AddBundleAsync(seed, _coffee, 1, 5m);
        }

        var list = await new GetMixMatchPromotionsHandler(TestDb.Create(_dbName), TestRequest.As(_userId))
            .Handle(new GetMixMatchPromotionsQuery(), CancellationToken.None);

        list.Select(x => x.Name).ShouldBe(["A", "Z", "B"]);
        list[0].BundlePrice.ShouldBe(10m);
    }
}
