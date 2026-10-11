using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Products;
using WTF.Api.Features.Products.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

/// <summary>Product handlers against a real SQL Server: unique keys, foreign keys, collation and SQL translation.</summary>
public class ProductDatabaseTests
{
    private static CreateProductHandler Create(WTFDbContext db, Guid userId) =>
        new(db, TestRequest.As(userId), TestFakes.Audit());

    private static CreateProductCommand NewProduct(string code, string name = "Latte") => new()
    {
        Name = name,
        Code = code,
        Price = 10m,
        Category = ProductCategoryEnum.Drink,
    };

    private static Product Row(Guid userId, string code, string name = "Latte", int categoryId = 1) => new()
    {
        Id = Guid.NewGuid(),
        Name = name,
        Code = code,
        Price = 10m,
        CategoryId = categoryId,
        IsActive = true,
        CreatedAt = DateTime.UtcNow,
        CreatedBy = userId,
    };

    [SqlFact]
    public async Task CreateProduct_SameCodeTwice_SecondIsRejectedByTheCheck()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);

        await using (var db = database.CreateContext())
        {
            await Create(db, user.Id).Handle(NewProduct("LAT"), CancellationToken.None);
        }

        await using (var db = database.CreateContext())
        {
            var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
                Create(db, user.Id).Handle(NewProduct("LAT", "Other"), CancellationToken.None));
            ex.Message.ShouldBe("Product code already exists.");
        }

        await using var check = database.CreateContext();
        (await check.Products.CountAsync()).ShouldBe(1);
    }

    [SqlFact]
    public async Task CreateProduct_CodeDifferingOnlyInCase_IsRejected()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);

        await using (var db = database.CreateContext())
        {
            await Create(db, user.Id).Handle(NewProduct("lat"), CancellationToken.None);
        }

        await using (var db = database.CreateContext())
        {
            await Should.ThrowAsync<InvalidOperationException>(() =>
                Create(db, user.Id).Handle(NewProduct("Lat", "Other"), CancellationToken.None));
        }

        await using var check = database.CreateContext();
        (await check.Products.SingleAsync()).Code.ShouldBe("LAT");
    }

    [SqlFact]
    public async Task CreateProduct_LowercaseCodeStoredByAnotherPath_IsStillFoundByTheCheck()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        await using (var db = database.CreateContext())
        {
            db.Products.Add(Row(user.Id, "lat")); // bypasses NormalizeCode
            await db.SaveChangesAsync();
        }

        // The column collation is case-insensitive, so "LAT" == "lat" in the AnyAsync check.
        await using var create = database.CreateContext();
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create(create, user.Id).Handle(NewProduct("LAT", "Other"), CancellationToken.None));
    }

    [SqlFact]
    public async Task ProductsTable_UniqueIndexOnCode_RejectsADuplicateEvenWhenTheHandlerCheckIsSkipped()
    {
        // UX_Products_Code (tools/sql/20261011_add_unique_username_and_product_code_indexes.sql) backs up
        // EnsureUniqueCodeAsync, e.g. for two creates racing each other.
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);

        await using (var db = database.CreateContext())
        {
            db.Products.Add(Row(user.Id, "LAT"));
            await db.SaveChangesAsync();
        }

        await using (var db = database.CreateContext())
        {
            db.Products.Add(Row(user.Id, "LAT", "Duplicate"));
            await Should.ThrowAsync<DbUpdateException>(() => db.SaveChangesAsync());
        }

        await using var check = database.CreateContext();
        (await check.Products.CountAsync(p => p.Code == "LAT")).ShouldBe(1);
    }

    [SqlFact]
    public async Task CreateProduct_UnknownCategory_IsRejectedWithAClearMessage()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);

        await using (var db = database.CreateContext())
        {
            var command = NewProduct("BAD") with { Category = (ProductCategoryEnum)999 };
            var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
                Create(db, user.Id).Handle(command, CancellationToken.None));
            ex.Message.ShouldBe("Product category is not valid.");
        }

        await using var check = database.CreateContext();
        (await check.Products.CountAsync()).ShouldBe(0);
    }

    [SqlFact]
    public async Task CreateProduct_AfterSoftDelete_CodeStaysReservedUntilRestore()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var product = await SqlSeed.ProductAsync(database, user.Id, "Latte", 10m, "LAT");

        await using (var db = database.CreateContext())
        {
            (await new DeleteProductHandler(db, TestRequest.As(user.Id), TestFakes.Audit())
                .Handle(new DeleteProductCommand(product.Id), CancellationToken.None)).ShouldBeTrue();
        }

        await using (var db = database.CreateContext())
        {
            await Should.ThrowAsync<InvalidOperationException>(() =>
                Create(db, user.Id).Handle(NewProduct("LAT", "Other"), CancellationToken.None));
        }

        await using (var db = database.CreateContext())
        {
            (await new RestoreProductHandler(db, TestRequest.As(user.Id), TestFakes.Audit())
                .Handle(new RestoreProductCommand(product.Id), CancellationToken.None)).ShouldBeTrue();
        }

        await using var check = database.CreateContext();
        var saved = await check.Products.SingleAsync();
        saved.IsActive.ShouldBeTrue();
        saved.Code.ShouldBe("LAT");
    }

    // ---- GetProducts search ----

    [SqlTheory]
    [InlineData("latte")]
    [InlineData("LATTE")]
    [InlineData("aTT")]
    public async Task GetProducts_SearchTermInAnyCase_MatchesUnderTheSqlCollation(string term)
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        await SqlSeed.ProductAsync(database, user.Id, "Latte", 10m, "LAT");
        await SqlSeed.ProductAsync(database, user.Id, "Mocha", 12m, "MOC");

        await using var db = database.CreateContext();
        var result = await new GetProductsHandler(db, TestRequest.As(user.Id))
            .Handle(new GetProductsQuery { SearchTerm = term }, CancellationToken.None);

        result.Select(p => p.Name).ShouldBe(["Latte"]);
    }

    [SqlFact]
    public async Task GetProducts_SearchTermWithLikeWildcard_IsTreatedAsLiteralText()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        await SqlSeed.ProductAsync(database, user.Id, "Latte", 10m, "LAT");
        await SqlSeed.ProductAsync(database, user.Id, "100% Juice", 5m, "JUI");

        await using var db = database.CreateContext();
        var result = await new GetProductsHandler(db, TestRequest.As(user.Id))
            .Handle(new GetProductsQuery { SearchTerm = "%" }, CancellationToken.None);

        result.Select(p => p.Name).ShouldBe(["100% Juice"]);
    }

    // ---- Add-on price override ----

    private static async Task<(Product Main, Product AddOn)> SeedLinkedAsync(SqlTestDatabase database, Guid userId)
    {
        var main = await SqlSeed.ProductAsync(database, userId, "Latte", 10m, "LAT");
        var addOn = await SqlSeed.ProductAsync(database, userId, "Shot", 2m, "SHT");
        await using var db = database.CreateContext();
        db.ProductAddOns.Add(new ProductAddOn { ProductId = main.Id, AddOnId = addOn.Id, IsActive = true });
        await db.SaveChangesAsync();
        return (main, addOn);
    }

    private static ProductAddOnPriceOverride OverrideRow(Guid userId, Guid productId, Guid addOnId) => new()
    {
        Id = Guid.NewGuid(),
        ProductId = productId,
        AddOnId = addOnId,
        Price = 1m,
        IsActive = true,
        CreatedAt = DateTime.UtcNow,
        CreatedBy = userId,
    };

    [SqlFact]
    public async Task CreateOverride_ActiveLink_IsStoredOnce()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var (main, addOn) = await SeedLinkedAsync(database, user.Id);

        await using (var db = database.CreateContext())
        {
            var result = await new CreateProductAddOnPriceOverrideHandler(db, TestRequest.As(user.Id))
                .Handle(new CreateProductAddOnPriceOverrideCommand { ProductId = main.Id, AddOnId = addOn.Id, Price = 1.5m },
                    CancellationToken.None);
            result.ShouldNotBeNull().Price.ShouldBe(1.5m);
        }

        await using var check = database.CreateContext();
        (await check.ProductAddOnPriceOverrides.SingleAsync()).Price.ShouldBe(1.5m);
    }

    [SqlFact]
    public async Task ProductAddOnPriceOverrides_DuplicateProductAddOnPair_IsRejectedByTheUniqueIndex()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var (main, addOn) = await SeedLinkedAsync(database, user.Id);

        await using (var db = database.CreateContext())
        {
            db.ProductAddOnPriceOverrides.Add(OverrideRow(user.Id, main.Id, addOn.Id));
            await db.SaveChangesAsync();
        }

        await using (var db = database.CreateContext())
        {
            db.ProductAddOnPriceOverrides.Add(OverrideRow(user.Id, main.Id, addOn.Id));
            var ex = await Should.ThrowAsync<DbUpdateException>(() => db.SaveChangesAsync());
            ex.InnerException.ShouldBeOfType<SqlException>().Number.ShouldBeOneOf(2601, 2627);
        }

        await using var check = database.CreateContext();
        (await check.ProductAddOnPriceOverrides.CountAsync()).ShouldBe(1);
    }

    [SqlFact]
    public async Task ProductAddOnPriceOverrides_PairWithoutProductAddOnLink_IsRejectedByTheForeignKey()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var main = await SqlSeed.ProductAsync(database, user.Id, "Latte", 10m, "LAT");
        var addOn = await SqlSeed.ProductAsync(database, user.Id, "Shot", 2m, "SHT"); // both exist, never linked

        await using var db = database.CreateContext();
        db.ProductAddOnPriceOverrides.Add(OverrideRow(user.Id, main.Id, addOn.Id));

        var ex = await Should.ThrowAsync<DbUpdateException>(() => db.SaveChangesAsync());
        ex.InnerException.ShouldBeOfType<SqlException>().Number.ShouldBe(547);
    }

    [SqlFact]
    public async Task CreateOverride_SoftDeletedOverride_ReusesTheRowSoTheUniqueIndexIsNotHit()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var (main, addOn) = await SeedLinkedAsync(database, user.Id);
        await using (var db = database.CreateContext())
        {
            var row = OverrideRow(user.Id, main.Id, addOn.Id);
            row.IsActive = false;
            db.ProductAddOnPriceOverrides.Add(row);
            await db.SaveChangesAsync();
        }

        await using (var db = database.CreateContext())
        {
            var result = await new CreateProductAddOnPriceOverrideHandler(db, TestRequest.As(user.Id))
                .Handle(new CreateProductAddOnPriceOverrideCommand { ProductId = main.Id, AddOnId = addOn.Id, Price = 3m },
                    CancellationToken.None);
            result.ShouldNotBeNull().IsActive.ShouldBeTrue();
        }

        await using var check = database.CreateContext();
        var saved = await check.ProductAddOnPriceOverrides.SingleAsync();
        saved.Price.ShouldBe(3m);
        saved.IsActive.ShouldBeTrue();
    }
}
