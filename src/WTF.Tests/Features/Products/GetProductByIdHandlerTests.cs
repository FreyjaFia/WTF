using WTF.Api.Features.Products;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Products;

public class GetProductByIdHandlerTests
{
    private readonly string _dbName = TestDb.NewName();

    private GetProductByIdHandler Handler() => new(TestDb.Create(_dbName), TestRequest.None());

    [Fact]
    public async Task Handle_UnknownId_ReturnsNull()
    {
        var result = await Handler().Handle(new GetProductByIdQuery(Guid.NewGuid()), CancellationToken.None);

        result.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_InactiveProduct_IsStillReturned()
    {
        var product = ProductSeed.NewProduct(isActive: false);
        await ProductSeed.SeedAsync(_dbName, product);

        var result = await Handler().Handle(new GetProductByIdQuery(product.Id), CancellationToken.None);

        result.ShouldNotBeNull();
        result.IsActive.ShouldBeFalse();
    }

    [Fact]
    public async Task Handle_ProductWithImageAndPriceHistory_ReturnsImageAndNewestHistoryFirst()
    {
        var userId = Guid.NewGuid();
        var product = ProductSeed.NewProduct(price: 130m);
        var productImage = ProductSeed.NewImage(product.Id, "https://cdn.example/a.png", out var image);
        var older = new ProductPriceHistory { Id = Guid.NewGuid(), ProductId = product.Id, OldPrice = 100m, NewPrice = 110m, UpdatedAt = new DateTime(2025, 2, 1), UpdatedBy = userId };
        var newer = new ProductPriceHistory { Id = Guid.NewGuid(), ProductId = product.Id, OldPrice = 110m, NewPrice = 130m, UpdatedAt = new DateTime(2025, 3, 1), UpdatedBy = userId };
        await ProductSeed.SeedAsync(_dbName, product, image, productImage, ProductSeed.NewUser(userId, "Ada", "Lovelace"), older, newer);

        var result = await Handler().Handle(new GetProductByIdQuery(product.Id), CancellationToken.None);

        result.ShouldNotBeNull();
        result.ImageUrl.ShouldBe("https://cdn.example/a.png");
        result.PriceHistory.Select(h => h.NewPrice).ShouldBe([130m, 110m]);
        result.PriceHistory[0].UpdatedByName.ShouldBe("Ada Lovelace");
    }

    [Fact]
    public async Task Handle_ProductWithoutImage_ReturnsNullImageUrlAndEmptyHistory()
    {
        var product = ProductSeed.NewProduct();
        await ProductSeed.SeedAsync(_dbName, product);

        var result = await Handler().Handle(new GetProductByIdQuery(product.Id), CancellationToken.None);

        result!.ImageUrl.ShouldBeNull();
        result.PriceHistory.ShouldBeEmpty();
    }
}
