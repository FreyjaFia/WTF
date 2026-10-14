using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Products;
using WTF.Api.Features.Products.Enums;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Products;

public class CreateProductHandlerTests
{
    private readonly Guid _userId = Guid.NewGuid();
    private readonly string _dbName = TestDb.NewName();
    private readonly IAuditService _audit = TestFakes.Audit();

    private CreateProductHandler Handler() => new(TestDb.Create(_dbName), TestRequest.As(_userId), _audit);

    [Fact]
    public async Task Handle_ValidProduct_IsSavedWithNormalizedCodeAndAudited()
    {
        var dto = await Handler().Handle(new CreateProductCommand
        {
            Name = "Latte",
            Code = " lat1 ",
            Price = 120.5m,
            Category = ProductCategoryEnum.Drink,
            SubCategory = ProductSubCategoryEnum.Coffee
        }, CancellationToken.None);

        dto.Code.ShouldBe("LAT1");
        dto.IsActive.ShouldBeTrue();
        dto.PriceHistory.ShouldBeEmpty();

        await using var db = TestDb.Create(_dbName);
        var saved = await db.Products.SingleAsync();
        saved.Id.ShouldBe(dto.Id);
        saved.Code.ShouldBe("LAT1");
        saved.Price.ShouldBe(120.5m);
        saved.CategoryId.ShouldBe((int)ProductCategoryEnum.Drink);
        saved.SubCategoryId.ShouldBe((int)ProductSubCategoryEnum.Coffee);
        saved.CreatedBy.ShouldBe(_userId);
        await _audit.Received(1).LogAsync(
            AuditAction.ProductCreated, AuditEntityType.Product, saved.Id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_WithoutSubCategory_StoresNullSubCategory()
    {
        await Handler().Handle(new CreateProductCommand { Name = "Cake", Code = "CK", Price = 5m, Category = ProductCategoryEnum.Dessert }, CancellationToken.None);

        await using var db = TestDb.Create(_dbName);
        (await db.Products.SingleAsync()).SubCategoryId.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_DuplicateCodeDifferingByCaseAndSpaces_ThrowsAndSavesNothing()
    {
        await ProductSeed.SeedAsync(_dbName, ProductSeed.NewProduct(code: "LAT"));

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(
            new CreateProductCommand { Name = "Other", Code = " lat ", Price = 1m, Category = ProductCategoryEnum.Food },
            CancellationToken.None));

        ex.Message.ShouldBe("Product code already exists.");
        await using var db = TestDb.Create(_dbName);
        (await db.Products.CountAsync()).ShouldBe(1);
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Handle_InactiveAddOnRequest_IsStoredAsRequested()
    {
        await Handler().Handle(new CreateProductCommand
        {
            Name = "Extra shot",
            Code = "XS",
            Price = 0m,
            Category = ProductCategoryEnum.Drink,
            IsAddOn = true,
            IsActive = false
        }, CancellationToken.None);

        await using var db = TestDb.Create(_dbName);
        var saved = await db.Products.SingleAsync();
        saved.IsAddOn.ShouldBeTrue();
        saved.IsActive.ShouldBeFalse();
    }

    // Unique code beyond the in-code check: see Database/ProductDatabaseTests.cs.
}
