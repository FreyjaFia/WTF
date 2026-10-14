using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Promotions;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Promotions;

public class FixedBundleHandlersTests : IAsyncLifetime
{
    private readonly Guid _userId = Guid.NewGuid();
    private readonly string _dbName = TestDb.NewName();
    private readonly Guid _burger = Guid.NewGuid();
    private readonly Guid _cheese = Guid.NewGuid();
    private readonly Guid _bacon = Guid.NewGuid();

    /// <summary>The handlers check that every product in a bundle exists, so the three products are saved first.</summary>
    public async Task InitializeAsync()
    {
        await using var db = TestDb.Create(_dbName);
        foreach (var (id, name) in new[] { (_burger, "Burger"), (_cheese, "Cheese"), (_bacon, "Bacon") })
        {
            db.Products.Add(new WTF.Domain.Entities.Product
            {
                Id = id,
                Name = name,
                Code = name.ToUpperInvariant(),
                Price = 10m,
                CategoryId = 1,
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
                CreatedBy = _userId,
            });
        }

        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Create_UnknownProduct_ThrowsAClearErrorAndSavesNothing()
    {
        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(Guid.NewGuid()), CancellationToken.None));

        ex.Message.ShouldBe("One or more bundle products do not exist.");
        await using var db = TestDb.Create(_dbName);
        (await db.Promotions.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Create_UnknownAddOnProduct_ThrowsAClearError()
    {
        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(_burger, 1, Guid.NewGuid()), CancellationToken.None));

        ex.Message.ShouldBe("One or more bundle products do not exist.");
    }

    private CreateFixedBundlePromotionHandler Create() => new(TestDb.Create(_dbName), TestRequest.As(_userId));
    private UpdateFixedBundlePromotionHandler Update() => new(TestDb.Create(_dbName), TestRequest.As(_userId));

    private static CreateFixedBundlePromotionCommand Cmd(Guid productId, int qty = 1, params Guid[] addOns) => new()
    {
        Name = "  Combo  ",
        BundlePrice = 99.5m,
        Items = [new CreateFixedBundlePromotionItemRequestDto(productId, qty,
            [.. addOns.Select(a => new CreateFixedBundlePromotionItemAddOnRequestDto(a, 1))])]
    };

    [Fact]
    public async Task Create_ValidBundle_SavesPromotionItemsAndAddOnsWithTrimmedName()
    {
        await using (var seed = TestDb.Create(_dbName))
            await PromotionSeed.LinkAddOnAsync(seed, _burger, _cheese);

        var dto = await Create().Handle(Cmd(_burger, 2, _cheese), CancellationToken.None);

        dto.Name.ShouldBe("Combo");
        dto.BundlePrice.ShouldBe(99.5m);
        dto.CreatedBy.ShouldBe(_userId);
        await using var db = TestDb.Create(_dbName);
        var saved = await db.Promotions
            .Include(x => x.FixedBundlePromotion!).ThenInclude(x => x.FixedBundlePromotionItems)
            .ThenInclude(x => x.FixedBundlePromotionItemAddOns).SingleAsync();
        saved.TypeId.ShouldBe(PromotionTypeIds.FixedBundle);
        saved.IsActive.ShouldBeTrue();
        saved.CreatedBy.ShouldBe(_userId);
        var item = saved.FixedBundlePromotion!.FixedBundlePromotionItems.Single();
        item.ProductId.ShouldBe(_burger);
        item.Quantity.ShouldBe(2);
        item.FixedBundlePromotionItemAddOns.Single().AddOnProductId.ShouldBe(_cheese);
    }

    [Fact]
    public async Task Create_InactiveWithDates_KeepsFlagAndDates()
    {
        var start = PromotionSeed.Now;
        var end = PromotionSeed.Now.AddDays(5);
        var cmd = Cmd(_burger) with { IsActive = false, StartDate = start, EndDate = end };

        var dto = await Create().Handle(cmd, CancellationToken.None);

        dto.IsActive.ShouldBeFalse();
        await using var db = TestDb.Create(_dbName);
        var saved = await db.Promotions.SingleAsync();
        saved.StartDate.ShouldBe(start);
        saved.EndDate.ShouldBe(end);
    }

    [Theory]
    [InlineData("")]
    [InlineData("  ")]
    public async Task Create_BlankName_ThrowsAndSavesNothing(string name)
    {
        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(_burger) with { Name = name }, CancellationToken.None));

        ex.Message.ShouldBe("Promotion name is required.");
        await using var db = TestDb.Create(_dbName);
        (await db.Promotions.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Create_EndBeforeStart_Throws()
    {
        var cmd = Cmd(_burger) with { StartDate = PromotionSeed.Now, EndDate = PromotionSeed.Now.AddDays(-1) };

        await Should.ThrowAsync<InvalidOperationException>(() => Create().Handle(cmd, CancellationToken.None));
    }

    [Fact]
    public async Task Create_NoItems_Throws()
    {
        var cmd = Cmd(_burger) with { Items = [] };

        await Should.ThrowAsync<InvalidOperationException>(() => Create().Handle(cmd, CancellationToken.None));
    }

    [Fact]
    public async Task Create_ZeroQuantity_Throws()
    {
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(_burger, 0), CancellationToken.None));
    }

    [Fact]
    public async Task Create_AddOnNotLinked_ThrowsAndSavesNothing()
    {
        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(_burger, 1, _cheese), CancellationToken.None));

        ex.Message.ShouldContain("not linked");
        await using var db = TestDb.Create(_dbName);
        (await db.Promotions.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Create_AddOnLinkIsInactive_Throws()
    {
        await using (var seed = TestDb.Create(_dbName))
            await PromotionSeed.LinkAddOnAsync(seed, _burger, _cheese, isActive: false);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(_burger, 1, _cheese), CancellationToken.None));
    }

    [Fact]
    public async Task Create_AddOnLinkedToDifferentProduct_Throws()
    {
        await using (var seed = TestDb.Create(_dbName))
            await PromotionSeed.LinkAddOnAsync(seed, Guid.NewGuid(), _cheese);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(_burger, 1, _cheese), CancellationToken.None));
    }

    [Fact]
    public async Task Create_SeveralAddOnsAllLinked_Succeeds()
    {
        await using (var seed = TestDb.Create(_dbName))
        {
            await PromotionSeed.LinkAddOnAsync(seed, _burger, _cheese);
            await PromotionSeed.LinkAddOnAsync(seed, _burger, _bacon);
        }

        var dto = await Create().Handle(Cmd(_burger, 1, _cheese, _bacon), CancellationToken.None);

        dto.Items.Single().AddOns.Count.ShouldBe(2);
    }

    [Fact]
    public async Task Create_SeveralAddOnsOneUnlinked_Throws()
    {
        await using (var seed = TestDb.Create(_dbName))
            await PromotionSeed.LinkAddOnAsync(seed, _burger, _cheese);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(Cmd(_burger, 1, _cheese, _bacon), CancellationToken.None));
    }

    [Fact]
    public async Task Update_ExistingBundle_RebuildsItemsAndStampsUpdater()
    {
        Guid id;
        await using (var seed = TestDb.Create(_dbName))
        {
            await PromotionSeed.LinkAddOnAsync(seed, _burger, _cheese);
            id = (await PromotionSeed.AddBundleAsync(seed, _burger, 1, 50m, _cheese)).Id;
        }
        var newProduct = _bacon;
        var cmd = new UpdateFixedBundlePromotionCommand
        {
            PromotionId = id,
            Name = " Renamed ",
            BundlePrice = 70m,
            IsActive = false,
            Items = [new CreateFixedBundlePromotionItemRequestDto(newProduct, 3, [])]
        };

        var dto = await Update().Handle(cmd, CancellationToken.None);

        dto.ShouldNotBeNull();
        dto.Name.ShouldBe("Renamed");
        dto.Items.Single().ProductId.ShouldBe(newProduct);
        await using var db = TestDb.Create(_dbName);
        var saved = await db.Promotions.Include(x => x.FixedBundlePromotion!)
            .ThenInclude(x => x.FixedBundlePromotionItems).SingleAsync();
        saved.IsActive.ShouldBeFalse();
        saved.UpdatedBy.ShouldBe(_userId);
        saved.UpdatedAt.ShouldNotBeNull();
        saved.FixedBundlePromotion!.BundlePrice.ShouldBe(70m);
        saved.FixedBundlePromotion.FixedBundlePromotionItems.Single().Quantity.ShouldBe(3);
        (await db.FixedBundlePromotionItems.CountAsync()).ShouldBe(1);
        (await db.FixedBundlePromotionItemAddOns.CountAsync()).ShouldBe(0);
    }

    // Foreign keys and orders referencing a bundle are tested against SQL Server in Database\PromotionDatabaseTests.cs.

    [Fact]
    public async Task Update_UnknownPromotion_ReturnsNull()
    {
        var cmd = new UpdateFixedBundlePromotionCommand
        {
            PromotionId = Guid.NewGuid(),
            Name = "x",
            Items = [new(_burger, 1, [])]
        };

        (await Update().Handle(cmd, CancellationToken.None)).ShouldBeNull();
    }

    [Fact]
    public async Task Update_PromotionOfAnotherType_ReturnsNull()
    {
        Guid id;
        await using (var seed = TestDb.Create(_dbName))
            id = (await PromotionSeed.AddMixMatchAsync(seed)).Id;
        var cmd = new UpdateFixedBundlePromotionCommand { PromotionId = id, Name = "x", Items = [new(_burger, 1, [])] };

        (await Update().Handle(cmd, CancellationToken.None)).ShouldBeNull();
    }

    [Fact]
    public async Task Update_InvalidItems_ThrowsAndLeavesPromotionUntouched()
    {
        Guid id;
        await using (var seed = TestDb.Create(_dbName))
            id = (await PromotionSeed.AddBundleAsync(seed, _burger, 1, 50m)).Id;
        var cmd = new UpdateFixedBundlePromotionCommand { PromotionId = id, Name = "New", Items = [new(_burger, 0, [])] };

        await Should.ThrowAsync<InvalidOperationException>(() => Update().Handle(cmd, CancellationToken.None));

        await using var db = TestDb.Create(_dbName);
        (await db.Promotions.SingleAsync()).Name.ShouldBe("Bundle");
    }

    [Fact]
    public async Task Update_AddOnNotLinked_Throws()
    {
        Guid id;
        await using (var seed = TestDb.Create(_dbName))
            id = (await PromotionSeed.AddBundleAsync(seed, _burger, 1, 50m)).Id;
        var cmd = new UpdateFixedBundlePromotionCommand
        {
            PromotionId = id,
            Name = "New",
            Items = [new(_burger, 1, [new(_cheese, 1)])]
        };

        await Should.ThrowAsync<InvalidOperationException>(() => Update().Handle(cmd, CancellationToken.None));
    }

    [Fact]
    public async Task Delete_ExistingBundle_SoftDeletesAndKeepsRules()
    {
        Guid id;
        await using (var seed = TestDb.Create(_dbName))
            id = (await PromotionSeed.AddBundleAsync(seed, _burger, 1, 50m)).Id;

        var result = await new DeleteFixedBundlePromotionHandler(TestDb.Create(_dbName), TestRequest.As(_userId))
            .Handle(new DeleteFixedBundlePromotionCommand(id), CancellationToken.None);

        result.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        var saved = await db.Promotions.SingleAsync();
        saved.IsActive.ShouldBeFalse();
        saved.UpdatedBy.ShouldBe(_userId);
        (await db.FixedBundlePromotionItems.CountAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task Delete_UnknownOrOtherType_ReturnsFalse()
    {
        Guid mixId;
        await using (var seed = TestDb.Create(_dbName))
            mixId = (await PromotionSeed.AddMixMatchAsync(seed)).Id;
        var handler = new DeleteFixedBundlePromotionHandler(TestDb.Create(_dbName), TestRequest.As(_userId));

        (await handler.Handle(new DeleteFixedBundlePromotionCommand(Guid.NewGuid()), CancellationToken.None)).ShouldBeFalse();
        (await handler.Handle(new DeleteFixedBundlePromotionCommand(mixId), CancellationToken.None)).ShouldBeFalse();
    }

    [Fact]
    public async Task GetById_ExistingBundle_ReturnsDtoWithItems()
    {
        Guid id;
        await using (var seed = TestDb.Create(_dbName))
            id = (await PromotionSeed.AddBundleAsync(seed, _burger, 2, 50m, _cheese)).Id;

        var dto = await new GetFixedBundlePromotionByIdHandler(TestDb.Create(_dbName), TestRequest.As(_userId))
            .Handle(new GetFixedBundlePromotionByIdQuery(id), CancellationToken.None);

        dto.ShouldNotBeNull();
        dto.BundlePrice.ShouldBe(50m);
        dto.Items.Single().Quantity.ShouldBe(2);
        dto.Items.Single().AddOns.Single().AddOnProductId.ShouldBe(_cheese);
    }

    [Fact]
    public async Task GetById_UnknownOrOtherType_ReturnsNull()
    {
        Guid mixId;
        await using (var seed = TestDb.Create(_dbName))
            mixId = (await PromotionSeed.AddMixMatchAsync(seed)).Id;
        var handler = new GetFixedBundlePromotionByIdHandler(TestDb.Create(_dbName), TestRequest.As(_userId));

        (await handler.Handle(new GetFixedBundlePromotionByIdQuery(Guid.NewGuid()), CancellationToken.None)).ShouldBeNull();
        (await handler.Handle(new GetFixedBundlePromotionByIdQuery(mixId), CancellationToken.None)).ShouldBeNull();
    }

    [Fact]
    public async Task List_MixedPromotions_ReturnsOnlyBundlesActiveFirstThenByName()
    {
        await using (var seed = TestDb.Create(_dbName))
        {
            await PromotionSeed.AddBundleAsync(seed, _burger, 1, 10m, isActive: false, name: "A inactive");
            await PromotionSeed.AddBundleAsync(seed, _burger, 1, 20m, name: "C active");
            await PromotionSeed.AddBundleAsync(seed, _burger, 1, 30m, name: "B active");
            await PromotionSeed.AddMixMatchAsync(seed);
        }

        var list = await new GetFixedBundlePromotionsHandler(TestDb.Create(_dbName), TestRequest.As(_userId))
            .Handle(new GetFixedBundlePromotionsQuery(), CancellationToken.None);

        list.Select(x => x.Name).ShouldBe(["B active", "C active", "A inactive"]);
        list[0].BundlePrice.ShouldBe(30m);
        list.ShouldAllBe(x => x.TypeId == PromotionTypeIds.FixedBundle);
    }
}
