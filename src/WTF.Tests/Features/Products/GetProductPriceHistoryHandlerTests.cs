using WTF.Api.Features.Products;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Products;

public class GetProductPriceHistoryHandlerTests
{
    private readonly string _dbName = TestDb.NewName();

    private GetProductPriceHistoryHandler Handler() => new(TestDb.Create(_dbName));

    private static ProductPriceHistory History(Guid productId, Guid userId, decimal? oldPrice, decimal newPrice, DateTime at) =>
        new() { Id = Guid.NewGuid(), ProductId = productId, OldPrice = oldPrice, NewPrice = newPrice, UpdatedAt = at, UpdatedBy = userId };

    [Fact]
    public async Task Handle_NoHistory_ReturnsEmptyList()
    {
        var result = await Handler().Handle(new GetProductPriceHistoryQuery(Guid.NewGuid()), CancellationToken.None);

        result.ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_ProductWithHistory_ReturnsNewestFirstWithUserName()
    {
        var userId = Guid.NewGuid();
        var product = ProductSeed.NewProduct();
        await ProductSeed.SeedAsync(_dbName, ProductSeed.NewUser(userId, "Grace", "Hopper"),
            History(product.Id, userId, null, 100m, new DateTime(2025, 1, 1)),
            History(product.Id, userId, 100m, 120m, new DateTime(2025, 3, 1)),
            History(product.Id, userId, 120m, 90m, new DateTime(2025, 2, 1)));

        var result = await Handler().Handle(new GetProductPriceHistoryQuery(product.Id), CancellationToken.None);

        result.Select(h => h.NewPrice).ShouldBe([120m, 90m, 100m]);
        result.Last().OldPrice.ShouldBeNull();
        result.ShouldAllBe(h => h.UpdatedByName == "Grace Hopper");
    }

    [Fact]
    public async Task Handle_OtherProductsHistory_IsExcluded()
    {
        var userId = Guid.NewGuid();
        var mine = Guid.NewGuid();
        await ProductSeed.SeedAsync(_dbName, ProductSeed.NewUser(userId),
            History(mine, userId, 1m, 2m, new DateTime(2025, 1, 1)),
            History(Guid.NewGuid(), userId, 5m, 6m, new DateTime(2025, 1, 2)));

        var result = await Handler().Handle(new GetProductPriceHistoryQuery(mine), CancellationToken.None);

        result.ShouldHaveSingleItem().NewPrice.ShouldBe(2m);
    }
}
