using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Products;
using WTF.Api.Features.Products.Enums;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Products;

public class UpdateProductHandlerTests
{
    private readonly Guid _userId = Guid.NewGuid();
    private readonly string _dbName = TestDb.NewName();
    private readonly IAuditService _audit = TestFakes.Audit();

    private UpdateProductHandler Handler() => new(TestDb.Create(_dbName), TestRequest.As(_userId), _audit);

    private static UpdateProductCommand Command(Product p, string? name = null, string? code = null, decimal? price = null,
        bool? isAddOn = null, bool? isActive = null) => new()
        {
            Id = p.Id,
            Name = name ?? p.Name,
            Code = code ?? p.Code,
            Price = price ?? p.Price,
            Category = ProductCategoryEnum.Drink,
            IsAddOn = isAddOn ?? p.IsAddOn,
            IsActive = isActive ?? p.IsActive
        };

    [Fact]
    public async Task Handle_UnknownProduct_ReturnsNullAndDoesNotAudit()
    {
        var result = await Handler().Handle(new UpdateProductCommand { Id = Guid.NewGuid(), Name = "x", Code = "X", Price = 1m }, CancellationToken.None);

        result.ShouldBeNull();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Handle_PriceChange_AddsPriceHistoryRowAndReturnsIt()
    {
        var product = ProductSeed.NewProduct(price: 100m);
        await ProductSeed.SeedAsync(_dbName, product, ProductSeed.NewUser(_userId, "Grace", "Hopper"));

        var dto = await Handler().Handle(Command(product, price: 120m), CancellationToken.None);

        dto.ShouldNotBeNull();
        dto.Price.ShouldBe(120m);
        dto.PriceHistory.Count.ShouldBe(1);
        dto.PriceHistory[0].UpdatedByName.ShouldBe("Grace Hopper");

        await using var db = TestDb.Create(_dbName);
        var history = await db.ProductPriceHistories.SingleAsync();
        history.ProductId.ShouldBe(product.Id);
        history.OldPrice.ShouldBe(100m);
        history.NewPrice.ShouldBe(120m);
        history.UpdatedBy.ShouldBe(_userId);
        (await db.Products.SingleAsync()).Price.ShouldBe(120m);
    }

    [Fact]
    public async Task Handle_PriceUnchanged_AddsNoPriceHistory()
    {
        var product = ProductSeed.NewProduct(price: 100m);
        await ProductSeed.SeedAsync(_dbName, product);

        await Handler().Handle(Command(product, name: "Renamed"), CancellationToken.None);

        await using var db = TestDb.Create(_dbName);
        (await db.ProductPriceHistories.CountAsync()).ShouldBe(0);
        (await db.Products.SingleAsync()).Name.ShouldBe("Renamed");
    }

    [Fact]
    public async Task Handle_ValidUpdate_StampsUpdaterNormalizesCodeAndAudits()
    {
        var product = ProductSeed.NewProduct(code: "OLD");
        await ProductSeed.SeedAsync(_dbName, product);

        await Handler().Handle(Command(product, code: " new "), CancellationToken.None);

        await using var db = TestDb.Create(_dbName);
        var saved = await db.Products.SingleAsync();
        saved.Code.ShouldBe("NEW");
        saved.UpdatedBy.ShouldBe(_userId);
        saved.UpdatedAt.ShouldNotBeNull();
        await _audit.Received(1).LogAsync(
            AuditAction.ProductUpdated, AuditEntityType.Product, product.Id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _userId, Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData(999, null, "Product category is not valid.")]
    [InlineData(0, null, "Product category is not valid.")]
    [InlineData(1, 999, "Product sub-category is not valid.")]
    public async Task Handle_UnknownCategoryOrSubCategory_IsRejectedAndNothingChanges(int category, int? subCategory, string message)
    {
        var product = ProductSeed.NewProduct(name: "Original");
        await ProductSeed.SeedAsync(_dbName, product);
        var command = Command(product, name: "Renamed") with
        {
            Category = (ProductCategoryEnum)category,
            SubCategory = subCategory.HasValue ? (ProductSubCategoryEnum)subCategory.Value : null,
        };

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(command, CancellationToken.None));

        ex.Message.ShouldBe(message);
        await using var db = TestDb.Create(_dbName);
        (await db.Products.SingleAsync(p => p.Id == product.Id)).Name.ShouldBe("Original");
    }

    [Fact]
    public async Task Handle_CodeBelongsToAnotherProduct_ThrowsAndKeepsOriginalCode()
    {
        var product = ProductSeed.NewProduct(code: "AAA");
        await ProductSeed.SeedAsync(_dbName, product, ProductSeed.NewProduct(name: "Other", code: "BBB"));

        await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(Command(product, code: "bbb"), CancellationToken.None));

        await using var db = TestDb.Create(_dbName);
        (await db.Products.SingleAsync(p => p.Id == product.Id)).Code.ShouldBe("AAA");
    }

    [Fact]
    public async Task Handle_SameCodeDifferentCase_IsNotTreatedAsDuplicate()
    {
        var product = ProductSeed.NewProduct(code: "AAA");
        await ProductSeed.SeedAsync(_dbName, product);

        var dto = await Handler().Handle(Command(product, code: "aaa"), CancellationToken.None);

        dto!.Code.ShouldBe("AAA");
    }

    [Fact]
    public async Task Handle_ConvertingToAddOnAfterBeingOrderedAsMainItem_Throws()
    {
        var product = ProductSeed.NewProduct();
        var orderItem = new OrderItem { Id = Guid.NewGuid(), OrderId = Guid.NewGuid(), ProductId = product.Id, Quantity = 1, ParentOrderItemId = null };
        await ProductSeed.SeedAsync(_dbName, product, orderItem);

        await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(Command(product, isAddOn: true), CancellationToken.None));

        await using var db = TestDb.Create(_dbName);
        (await db.Products.SingleAsync()).IsAddOn.ShouldBeFalse();
    }

    [Fact]
    public async Task Handle_ConvertingToAddOnWithoutMainItemOrders_Succeeds()
    {
        var product = ProductSeed.NewProduct();
        var parentId = Guid.NewGuid();
        // Only ever ordered as a child item, which does not block the conversion.
        var childItem = new OrderItem { Id = Guid.NewGuid(), OrderId = Guid.NewGuid(), ProductId = product.Id, Quantity = 1, ParentOrderItemId = parentId };
        await ProductSeed.SeedAsync(_dbName, product, childItem);

        var dto = await Handler().Handle(Command(product, isAddOn: true), CancellationToken.None);

        dto!.IsAddOn.ShouldBeTrue();
    }

    [Fact]
    public async Task Handle_ConvertingAddOnToProductWhileLinked_Throws()
    {
        var addOn = ProductSeed.NewProduct(name: "Shot", code: "SH", isAddOn: true);
        var parent = ProductSeed.NewProduct();
        await ProductSeed.SeedAsync(_dbName, addOn, parent, ProductSeed.NewLink(parent.Id, addOn.Id));

        await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(Command(addOn, isAddOn: false), CancellationToken.None));
    }

    [Fact]
    public async Task Handle_ConvertingAddOnToProductWithOnlyInactiveLinks_Succeeds()
    {
        var addOn = ProductSeed.NewProduct(name: "Shot", code: "SH", isAddOn: true);
        var parent = ProductSeed.NewProduct();
        await ProductSeed.SeedAsync(_dbName, addOn, parent, ProductSeed.NewLink(parent.Id, addOn.Id, isActive: false));

        var dto = await Handler().Handle(Command(addOn, isAddOn: false), CancellationToken.None);

        dto!.IsAddOn.ShouldBeFalse();
    }

    [Fact]
    public async Task Handle_ProductWithImage_ReturnsImageUrl()
    {
        var product = ProductSeed.NewProduct();
        var productImage = ProductSeed.NewImage(product.Id, "https://cdn.example/latte.png", out var image);
        await ProductSeed.SeedAsync(_dbName, product, image, productImage);

        var dto = await Handler().Handle(Command(product, name: "Latte 2"), CancellationToken.None);

        dto!.ImageUrl.ShouldBe("https://cdn.example/latte.png");
    }
}
