using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Catalog;
using WTF.Api.Features.Products;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

public class CatalogChangeLogDatabaseTests
{
    [SqlFact]
    public async Task ProductUpdate_SavesTheChangeAndItsLogRowTogether_WithRealForeignKeys()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var latte = await SqlSeed.ProductAsync(database, user.Id, "Latte", 100m);

        await using (var db = database.CreateContext())
        {
            await new UpdateProductHandler(db, TestRequest.As(user.Id), TestFakes.Audit())
                .Handle(new UpdateProductCommand { Id = latte.Id, Name = "Latte", Code = latte.Code, Price = 125m, Category = 1, IsActive = true }, CancellationToken.None);
        }

        await using var check = database.CreateContext();
        (await check.Products.SingleAsync()).Price.ShouldBe(125m);
        var row = await check.CatalogChangeLogs.SingleAsync();
        (row.EntityType, row.EntityId, row.Field, row.OldValue, row.NewValue).ShouldBe(("Product", latte.Id, "Price", "100.00", "125.00"));
        row.TenantId.ShouldBe(TenantDefaults.DefaultTenantId);
        row.ChangedBy.ShouldBe(user.Id);
    }

    [SqlFact]
    public async Task ARowForAShopThatDoesNotExist_IsRefusedByTheForeignKey()
    {
        await using var database = await SqlTestDatabase.CreateAsync();

        await using var db = database.CreateContext();
        db.CatalogChangeLogs.Add(new CatalogChangeLog
        {
            Id = Guid.NewGuid(),
            TenantId = Guid.NewGuid(),
            EntityType = "Product",
            EntityId = Guid.NewGuid(),
            Field = "Price",
            NewValue = "1.00",
            EffectiveFrom = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow,
        });

        await Should.ThrowAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [SqlFact]
    public async Task Reader_WorksOverSqlServer_AsOfAndBaseline()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var productId = Guid.NewGuid();
        var start = DateTime.UtcNow.AddHours(-2);

        await using (var db = database.CreateContext())
        {
            CatalogChangeRecorder.RecordBaseline(db, TenantDefaults.DefaultTenantId, start);
            CatalogChangeRecorder.Record(db, CatalogEntityTypes.Product, productId, "Price", "100.00", "120.00", null, start.AddHours(1));
            await db.SaveChangesAsync();
        }

        await using var read = database.CreateContext();
        (await CatalogHistory.DecimalAsOfAsync(read, CatalogEntityTypes.Product, productId, "Price", 120m, start.AddMinutes(30), default)).ShouldBe(100m);
        (await CatalogHistory.DecimalAsOfAsync(read, CatalogEntityTypes.Product, productId, "Price", 120m, start.AddHours(2), default)).ShouldBe(120m);
        (await CatalogHistory.HasHistorySinceAsync(read, TenantDefaults.DefaultTenantId, CatalogEntityTypes.Product, productId, start, default)).ShouldBeTrue();
        (await CatalogHistory.HasHistorySinceAsync(read, TenantDefaults.DefaultTenantId, CatalogEntityTypes.Product, productId, start.AddHours(-1), default)).ShouldBeFalse();
    }
}
