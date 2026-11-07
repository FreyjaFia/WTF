using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Catalog;
using WTF.Api.Services;
using WTF.Tests.Features.Products;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Catalog;

public class CatalogHandlerTests
{
    private readonly string _dbName = TestDb.NewName();
    private readonly IAuditService _audit = Substitute.For<IAuditService>();

    [Fact]
    public async Task Setup_CountsActiveProductsAndGroupsSubCategoriesUnderTheirCategory()
    {
        var latte = ProductSeed.NewProduct(categoryId: CatalogSeed.Drink);
        latte.SubCategoryId = CatalogSeed.Coffee;
        var gone = ProductSeed.NewProduct(name: "Old", code: "OLD", categoryId: CatalogSeed.Drink, isActive: false);
        gone.SubCategoryId = CatalogSeed.Coffee;
        var shot = ProductSeed.NewProduct(name: "Shot", code: "SH", isAddOn: true, categoryId: CatalogSeed.Other);
        await ProductSeed.SeedAsync(_dbName, latte, gone, shot, ProductSeed.NewLink(latte.Id, shot.Id, CatalogSeed.Extra));

        var setup = await new GetCatalogSetupHandler(TestDb.Create(_dbName))
            .Handle(new GetCatalogSetupQuery(), CancellationToken.None);

        var drink = setup.Categories.Single(c => c.Id == CatalogSeed.Drink);
        drink.ProductCount.ShouldBe(1);
        drink.SubCategories.Select(s => s.Name).ShouldBe(["Coffee", "NonCoffee"]);
        drink.SubCategories.Single(s => s.Id == CatalogSeed.Coffee).ProductCount.ShouldBe(1);
        setup.UnassignedSubCategories.ShouldBeEmpty();
        setup.AddOnTypes.Single(t => t.Id == CatalogSeed.Extra).ProductCount.ShouldBe(1);
        setup.AddOnTypes.Single(t => t.Id == CatalogSeed.Size).ProductCount.ShouldBe(0);
    }

    [Fact]
    public async Task SaveCategory_New_GetsNextIdAndIsAudited()
    {
        var id = await new SaveCategoryHandler(TestDb.Create(_dbName), _audit)
            .Handle(new SaveCategoryCommand(null, "  Bakery ", 9), CancellationToken.None);

        id.ShouldBe(5);
        var saved = TestDb.Create(_dbName).ProductCategories.Single(c => c.Id == id);
        saved.Name.ShouldBe("Bakery");
        saved.SortOrder.ShouldBe(9);
        saved.IsActive.ShouldBeTrue();
        await _audit.Received(1).LogAsync(AuditAction.CatalogCategorySaved, AuditEntityType.CatalogEntry,
            "category:5", Arg.Any<object?>(), Arg.Any<object?>(), Arg.Any<Guid?>(), Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task SaveCategory_BlankName_Refused(string name)
    {
        await Should.ThrowAsync<ArgumentException>(() => new SaveCategoryHandler(TestDb.Create(_dbName), _audit)
            .Handle(new SaveCategoryCommand(null, name, 1), CancellationToken.None));
    }

    [Fact]
    public async Task SaveCategory_NameOver50Characters_Refused()
    {
        await Should.ThrowAsync<ArgumentException>(() => new SaveCategoryHandler(TestDb.Create(_dbName), _audit)
            .Handle(new SaveCategoryCommand(null, new string('x', 51), 1), CancellationToken.None));
    }

    [Fact]
    public async Task SaveCategory_DuplicateName_RefusedButRenamingItselfIsFine()
    {
        var handler = new SaveCategoryHandler(TestDb.Create(_dbName), _audit);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            handler.Handle(new SaveCategoryCommand(null, "Food", 1), CancellationToken.None));

        var id = await new SaveCategoryHandler(TestDb.Create(_dbName), _audit)
            .Handle(new SaveCategoryCommand(CatalogSeed.Food, "Food", 7), CancellationToken.None);
        id.ShouldBe(CatalogSeed.Food);
        TestDb.Create(_dbName).ProductCategories.Single(c => c.Id == CatalogSeed.Food).SortOrder.ShouldBe(7);
    }

    [Fact]
    public async Task SaveCategory_UnknownId_NotFound()
    {
        await Should.ThrowAsync<KeyNotFoundException>(() => new SaveCategoryHandler(TestDb.Create(_dbName), _audit)
            .Handle(new SaveCategoryCommand(99, "Ghost", 1), CancellationToken.None));
    }

    [Fact]
    public async Task SetCategoryActive_OffWhileProductsUseIt_Refused()
    {
        await ProductSeed.SeedAsync(_dbName, ProductSeed.NewProduct(categoryId: CatalogSeed.Drink));

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            new SetCategoryActiveHandler(TestDb.Create(_dbName), _audit)
                .Handle(new SetCategoryActiveCommand(CatalogSeed.Drink, false), CancellationToken.None));

        ex.Message.ShouldContain("1 active product");
        TestDb.Create(_dbName).ProductCategories.Single(c => c.Id == CatalogSeed.Drink).IsActive.ShouldBeTrue();
    }

    [Fact]
    public async Task SetCategoryActive_OffThenBackOn_Works()
    {
        await new SetCategoryActiveHandler(TestDb.Create(_dbName), _audit)
            .Handle(new SetCategoryActiveCommand(CatalogSeed.Dessert, false), CancellationToken.None);
        TestDb.Create(_dbName).ProductCategories.Single(c => c.Id == CatalogSeed.Dessert).IsActive.ShouldBeFalse();

        await new SetCategoryActiveHandler(TestDb.Create(_dbName), _audit)
            .Handle(new SetCategoryActiveCommand(CatalogSeed.Dessert, true), CancellationToken.None);
        TestDb.Create(_dbName).ProductCategories.Single(c => c.Id == CatalogSeed.Dessert).IsActive.ShouldBeTrue();
    }

    [Fact]
    public async Task SaveSubCategory_New_BelongsToTheChosenCategory()
    {
        var id = await new SaveSubCategoryHandler(TestDb.Create(_dbName), _audit)
            .Handle(new SaveSubCategoryCommand(null, "Tea", CatalogSeed.Drink, 5), CancellationToken.None);

        var saved = TestDb.Create(_dbName).ProductSubCategories.Single(s => s.Id == id);
        saved.Name.ShouldBe("Tea");
        saved.CategoryId.ShouldBe(CatalogSeed.Drink);
    }

    [Fact]
    public async Task SaveSubCategory_UnknownCategory_Refused()
    {
        await Should.ThrowAsync<ArgumentException>(() => new SaveSubCategoryHandler(TestDb.Create(_dbName), _audit)
            .Handle(new SaveSubCategoryCommand(null, "Tea", 99, 5), CancellationToken.None));
    }

    [Fact]
    public async Task SaveSubCategory_DuplicateName_Refused()
    {
        await Should.ThrowAsync<InvalidOperationException>(() => new SaveSubCategoryHandler(TestDb.Create(_dbName), _audit)
            .Handle(new SaveSubCategoryCommand(null, "Coffee", CatalogSeed.Drink, 5), CancellationToken.None));
    }

    [Fact]
    public async Task SaveSubCategory_MovingItToAnotherCategory_Works()
    {
        await new SaveSubCategoryHandler(TestDb.Create(_dbName), _audit)
            .Handle(new SaveSubCategoryCommand(CatalogSeed.Snacks, "Snacks", CatalogSeed.Dessert, 3), CancellationToken.None);

        TestDb.Create(_dbName).ProductSubCategories.Single(s => s.Id == CatalogSeed.Snacks)
            .CategoryId.ShouldBe(CatalogSeed.Dessert);
    }

    [Fact]
    public async Task SetSubCategoryActive_OffWhileProductsUseIt_Refused()
    {
        var latte = ProductSeed.NewProduct();
        latte.SubCategoryId = CatalogSeed.Coffee;
        await ProductSeed.SeedAsync(_dbName, latte);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            new SetSubCategoryActiveHandler(TestDb.Create(_dbName), _audit)
                .Handle(new SetSubCategoryActiveCommand(CatalogSeed.Coffee, false), CancellationToken.None));
    }

    [Fact]
    public async Task SaveAddOnType_CustomTypeWithRules_IsSavedAndRequiredMeansAtLeastOne()
    {
        var id = await new SaveAddOnTypeHandler(TestDb.Create(_dbName), _audit)
            .Handle(new SaveAddOnTypeCommand(null, "Temperature", true, 0, 1, 6), CancellationToken.None);

        var saved = TestDb.Create(_dbName).AddOnTypes.Single(t => t.Id == id);
        saved.Name.ShouldBe("Temperature");
        saved.IsRequired.ShouldBeTrue();
        saved.MinSelect.ShouldBe(1);
        saved.MaxSelect.ShouldBe(1);
        saved.SortOrder.ShouldBe(6);
    }

    [Fact]
    public async Task SaveAddOnType_MinAboveMax_Refused()
    {
        await Should.ThrowAsync<ArgumentException>(() => new SaveAddOnTypeHandler(TestDb.Create(_dbName), _audit)
            .Handle(new SaveAddOnTypeCommand(null, "Odd", false, 3, 2, 6), CancellationToken.None));
    }

    [Fact]
    public async Task SaveAddOnType_NegativeCounts_Refused()
    {
        await Should.ThrowAsync<ArgumentException>(() => new SaveAddOnTypeHandler(TestDb.Create(_dbName), _audit)
            .Handle(new SaveAddOnTypeCommand(null, "Odd", false, -1, 0, 6), CancellationToken.None));
    }

    [Fact]
    public async Task SaveAddOnType_DuplicateName_Refused()
    {
        await Should.ThrowAsync<InvalidOperationException>(() => new SaveAddOnTypeHandler(TestDb.Create(_dbName), _audit)
            .Handle(new SaveAddOnTypeCommand(null, "Sauce", false, 0, 0, 6), CancellationToken.None));
    }

    [Fact]
    public async Task SetAddOnTypeActive_Size_NeverSwitchedOff()
    {
        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            new SetAddOnTypeActiveHandler(TestDb.Create(_dbName), _audit)
                .Handle(new SetAddOnTypeActiveCommand(CatalogSeed.Size, false), CancellationToken.None));

        ex.Message.ShouldContain("Size");
    }

    [Fact]
    public async Task SetAddOnTypeActive_OffWhileLinked_Refused()
    {
        var latte = ProductSeed.NewProduct();
        var shot = ProductSeed.NewProduct(name: "Shot", code: "SH", isAddOn: true);
        await ProductSeed.SeedAsync(_dbName, latte, shot, ProductSeed.NewLink(latte.Id, shot.Id, CatalogSeed.Sauce));

        await Should.ThrowAsync<InvalidOperationException>(() =>
            new SetAddOnTypeActiveHandler(TestDb.Create(_dbName), _audit)
                .Handle(new SetAddOnTypeActiveCommand(CatalogSeed.Sauce, false), CancellationToken.None));
    }

    [Fact]
    public async Task SetAddOnTypeActive_UnusedType_CanBeSwitchedOffAndOn()
    {
        await new SetAddOnTypeActiveHandler(TestDb.Create(_dbName), _audit)
            .Handle(new SetAddOnTypeActiveCommand(CatalogSeed.Topping, false), CancellationToken.None);
        TestDb.Create(_dbName).AddOnTypes.Single(t => t.Id == CatalogSeed.Topping).IsActive.ShouldBeFalse();

        await new SetAddOnTypeActiveHandler(TestDb.Create(_dbName), _audit)
            .Handle(new SetAddOnTypeActiveCommand(CatalogSeed.Topping, true), CancellationToken.None);
        TestDb.Create(_dbName).AddOnTypes.Single(t => t.Id == CatalogSeed.Topping).IsActive.ShouldBeTrue();
    }
}
