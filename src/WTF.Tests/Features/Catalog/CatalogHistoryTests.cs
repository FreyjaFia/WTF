using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Catalog;
using WTF.Api.Features.Products;
using WTF.Calculations.Catalog;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Features.Products;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Catalog;

public class CatalogHistoryTests
{
    private static readonly DateTime T0 = new(2026, 11, 10, 8, 0, 0, DateTimeKind.Utc);

    private readonly string _dbName = TestDb.NewName();
    private readonly Guid _user = Guid.NewGuid();
    private readonly Guid _tenant = Guid.NewGuid();
    private readonly Guid _product = Guid.NewGuid();

    private async Task AddRowsAsync(params CatalogChangeLog[] rows)
    {
        await using var db = TestDb.Create(_dbName);
        db.CatalogChangeLogs.AddRange(rows);
        await db.SaveChangesAsync();
    }

    private CatalogChangeLog Row(string field, string? oldValue, string? newValue, int hours, Guid? entityId = null, string entityType = CatalogEntityTypes.Product) => new()
    {
        Id = Guid.NewGuid(),
        EntityType = entityType,
        EntityId = entityId ?? _product,
        Field = field,
        OldValue = oldValue,
        NewValue = newValue,
        EffectiveFrom = T0.AddHours(hours),
        CreatedAt = T0.AddHours(hours),
    };

    private async Task SeedPriceHistoryAsync()
    {
        await AddRowsAsync(
            Row("Price", "100.00", "110.00", 1),
            Row("Price", "110.00", "130.00", 3),
            Row("IsActive", "true", "false", 2));
    }

    [Fact]
    public async Task ValueAsOf_WalksBackFromTheCurrentValue()
    {
        await SeedPriceHistoryAsync();
        await using var db = TestDb.Create(_dbName);

        (await CatalogHistory.DecimalAsOfAsync(db, CatalogEntityTypes.Product, _product, "Price", 130m, T0, default)).ShouldBe(100m);
        (await CatalogHistory.DecimalAsOfAsync(db, CatalogEntityTypes.Product, _product, "Price", 130m, T0.AddHours(2), default)).ShouldBe(110m);
        (await CatalogHistory.DecimalAsOfAsync(db, CatalogEntityTypes.Product, _product, "Price", 130m, T0.AddHours(3), default)).ShouldBe(130m);
        (await CatalogHistory.DecimalAsOfAsync(db, CatalogEntityTypes.Product, _product, "Price", 130m, T0.AddDays(5), default)).ShouldBe(130m);
    }

    [Fact]
    public async Task ValueAsOf_LooksOnlyAtTheAskedField()
    {
        await SeedPriceHistoryAsync();
        await using var db = TestDb.Create(_dbName);

        (await CatalogHistory.BoolAsOfAsync(db, CatalogEntityTypes.Product, _product, "IsActive", false, T0.AddHours(1), default)).ShouldBe(true);
        (await CatalogHistory.BoolAsOfAsync(db, CatalogEntityTypes.Product, _product, "IsActive", false, T0.AddHours(2), default)).ShouldBe(false);
    }

    [Fact]
    public async Task ValueAsOf_UnknownEntity_IsTheCurrentValue()
    {
        await SeedPriceHistoryAsync();
        await using var db = TestDb.Create(_dbName);

        (await CatalogHistory.ValueAsOfAsync(db, CatalogEntityTypes.Product, Guid.NewGuid(), "Price", "42.00", T0, default)).ShouldBe("42.00");
    }

    [Fact]
    public async Task ValueAsOf_BeforeTheEntityWasCreated_IsNull()
    {
        await AddRowsAsync(Row("Created", null, "1", 1), Row("Price", null, "100.00", 1));
        await using var db = TestDb.Create(_dbName);

        (await CatalogHistory.DecimalAsOfAsync(db, CatalogEntityTypes.Product, _product, "Price", 100m, T0, default)).ShouldBeNull();
    }

    [Fact]
    public async Task ChangesBetween_IsAfterExclusiveAndBeforeInclusive_OldestFirst()
    {
        await SeedPriceHistoryAsync();
        await using var db = TestDb.Create(_dbName);

        var changes = await CatalogHistory.ChangesBetweenAsync(db, CatalogEntityTypes.Product, _product, T0.AddHours(1), T0.AddHours(3), default);

        changes.Select(c => (c.Field, c.NewValue)).ShouldBe([("IsActive", "false"), ("Price", "130.00")]);
    }

    [Fact]
    public async Task ChangesBetween_CanBeNarrowedToOneField()
    {
        await SeedPriceHistoryAsync();
        await using var db = TestDb.Create(_dbName);

        var changes = await CatalogHistory.ChangesBetweenAsync(db, CatalogEntityTypes.Product, _product, T0, T0.AddDays(1), default, "Price");

        changes.Select(c => c.NewValue).ShouldBe(["110.00", "130.00"]);
    }

    [Fact]
    public async Task HasHistorySince_WithoutBaselineOrCreatedRow_IsFalse_SoCallersFallBack()
    {
        await SeedPriceHistoryAsync();
        await using var db = TestDb.Create(_dbName);

        (await CatalogHistory.HasHistorySinceAsync(db, _tenant, CatalogEntityTypes.Product, _product, T0, default)).ShouldBeFalse();
    }

    [Fact]
    public async Task HasHistorySince_BaselineBeforeTheTime_IsTrue_AndAfterTheTime_IsFalse()
    {
        await AddRowsAsync(Row(CatalogHistoryRules.BaselineField, null, "1", 0, _tenant, CatalogEntityTypes.Baseline));
        await using var db = TestDb.Create(_dbName);

        (await CatalogHistory.HasHistorySinceAsync(db, _tenant, CatalogEntityTypes.Product, _product, T0.AddHours(1), default)).ShouldBeTrue();
        (await CatalogHistory.HasHistorySinceAsync(db, _tenant, CatalogEntityTypes.Product, _product, T0.AddHours(-1), default)).ShouldBeFalse();
    }

    [Fact]
    public async Task HasHistorySince_AnEntityCreatedAfterLoggingStarted_IsTrueForAnyTime()
    {
        await AddRowsAsync(Row("Created", null, "1", 5));
        await using var db = TestDb.Create(_dbName);

        (await CatalogHistory.HasHistorySinceAsync(db, _tenant, CatalogEntityTypes.Product, _product, T0.AddYears(-1), default)).ShouldBeTrue();
    }

    [Fact]
    public async Task HasHistorySince_AnotherShopsBaseline_DoesNotCount()
    {
        await AddRowsAsync(Row(CatalogHistoryRules.BaselineField, null, "1", 0, Guid.NewGuid(), CatalogEntityTypes.Baseline));
        await using var db = TestDb.Create(_dbName);

        (await CatalogHistory.HasHistorySinceAsync(db, _tenant, CatalogEntityTypes.Product, _product, T0.AddHours(1), default)).ShouldBeFalse();
    }

    [Fact]
    public async Task WritingTwice_PriceThenPrice_CanBeReadBackAsOfBetweenTheTwoSaves()
    {
        var product = ProductSeed.NewProduct(price: 100m);
        await ProductSeed.SeedAsync(_dbName, product);
        var beforeFirst = DateTime.UtcNow.AddSeconds(-1);

        await Update(product, 120m);
        var between = DateTime.UtcNow;
        await Task.Delay(20);
        await Update(product, 150m);

        await using var db = TestDb.Create(_dbName);
        var current = (await db.Products.SingleAsync()).Price;
        current.ShouldBe(150m);
        (await CatalogHistory.DecimalAsOfAsync(db, CatalogEntityTypes.Product, product.Id, "Price", current, between, default)).ShouldBe(120m);
        (await CatalogHistory.DecimalAsOfAsync(db, CatalogEntityTypes.Product, product.Id, "Price", current, beforeFirst, default)).ShouldBe(100m);
    }

    [Fact]
    public async Task Update_NothingChanged_WritesNoRow()
    {
        var product = ProductSeed.NewProduct(price: 100m);
        await ProductSeed.SeedAsync(_dbName, product);

        await Update(product, 100m);

        await using var db = TestDb.Create(_dbName);
        (await db.CatalogChangeLogs.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Update_OnlyTheNameChanged_WritesNoRow()
    {
        var product = ProductSeed.NewProduct(price: 100m);
        await ProductSeed.SeedAsync(_dbName, product);

        await new UpdateProductHandler(TestDb.Create(_dbName), TestRequest.As(_user), TestFakes.Audit())
            .Handle(new UpdateProductCommand { Id = product.Id, Name = "Renamed", Code = product.Code, Price = 100m, Category = CatalogSeed.Drink, IsActive = true }, default);

        await using var db = TestDb.Create(_dbName);
        (await db.CatalogChangeLogs.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Update_PriceChange_RecordsOldAndNewAsInvariantText_WithWhoAndWhen()
    {
        var product = ProductSeed.NewProduct(price: 100m);
        await ProductSeed.SeedAsync(_dbName, product);
        var before = DateTime.UtcNow;

        await Update(product, 120.5m);

        await using var db = TestDb.Create(_dbName);
        var row = await db.CatalogChangeLogs.SingleAsync();
        (row.EntityType, row.EntityId, row.Field, row.OldValue, row.NewValue).ShouldBe((CatalogEntityTypes.Product, product.Id, "Price", "100.00", "120.50"));
        row.ChangedBy.ShouldBe(_user);
        row.EffectiveFrom.ShouldBeInRange(before, DateTime.UtcNow);
    }

    [Fact]
    public async Task Create_RecordsTheStartingValues_AndACreatedRow()
    {
        await new CreateProductHandler(TestDb.Create(_dbName), TestRequest.As(_user), TestFakes.Audit())
            .Handle(new CreateProductCommand { Name = "Latte", Code = "LAT", Price = 90m, Category = CatalogSeed.Drink }, default);

        await using var db = TestDb.Create(_dbName);
        var product = await db.Products.SingleAsync();
        var rows = await db.CatalogChangeLogs.ToListAsync();
        rows.ShouldAllBe(r => r.EntityId == product.Id);
        rows.Select(r => (r.Field, r.OldValue, r.NewValue)).ShouldBe(
            [("Created", null, "1"), ("IsActive", null, "true"), ("IsSeniorPwdEligible", null, "true"), ("Price", null, "90.00")],
            ignoreOrder: true);
    }

    [Fact]
    public async Task AddOnOverride_IsKeyedByTheProductAndAddOnPair()
    {
        var addOn = Guid.NewGuid();
        await ProductSeed.SeedAsync(_dbName, ProductSeed.NewLink(_product, addOn));
        await new CreateProductAddOnPriceOverrideHandler(TestDb.Create(_dbName), TestRequest.As(_user))
            .Handle(new CreateProductAddOnPriceOverrideCommand { ProductId = _product, AddOnId = addOn, Price = 4m }, default);
        await new UpdateProductAddOnPriceOverrideHandler(TestDb.Create(_dbName), TestRequest.As(_user))
            .Handle(new UpdateProductAddOnPriceOverrideCommand { ProductId = _product, AddOnId = addOn, Price = 6m }, default);

        await using var db = TestDb.Create(_dbName);
        var key = CatalogHistoryRules.AddOnOverrideKey(_product, addOn);
        var changes = await CatalogHistory.ChangesBetweenAsync(db, CatalogEntityTypes.AddOnPriceOverride, key, DateTime.UtcNow.AddMinutes(-1), DateTime.UtcNow.AddMinutes(1), default, "Price");
        changes.Select(c => (c.OldValue, c.NewValue)).ShouldBe([(null, "4.00"), ("4.00", "6.00")]);
    }

    [Fact]
    public async Task ALogRowThatCannotBeBuilt_NeverStopsTheCatalogChange()
    {
        var product = ProductSeed.NewProduct(price: 100m);
        await ProductSeed.SeedAsync(_dbName, product);
        await using var db = TestDb.Create(_dbName);
        var tracked = await db.Products.SingleAsync();
        tracked.Price = 99m;
        db.Entry(tracked).State = EntityState.Detached;

        Should.NotThrow(() => CatalogChangeRecorder.RecordProduct(db, tracked, _user));
    }

    [Fact]
    public async Task TwoShops_NeverSeeEachOthersLog()
    {
        var shopA = Guid.NewGuid();
        var shopB = Guid.NewGuid();
        var productA = Guid.NewGuid();
        var productB = Guid.NewGuid();

        await using (var a = TestDb.Create(_dbName, new FixedTenant(shopA)))
        {
            CatalogChangeRecorder.Record(a, CatalogEntityTypes.Product, productA, "Price", "1.00", "2.00", _user);
            CatalogChangeRecorder.RecordBaseline(a, shopA);
            await a.SaveChangesAsync();
        }

        await using (var b = TestDb.Create(_dbName, new FixedTenant(shopB)))
        {
            CatalogChangeRecorder.Record(b, CatalogEntityTypes.Product, productB, "Price", "5.00", "6.00", _user);
            await b.SaveChangesAsync();
        }

        await using var readA = TestDb.Create(_dbName, new FixedTenant(shopA));
        (await readA.CatalogChangeLogs.Select(l => l.TenantId).Distinct().ToListAsync()).ShouldBe([shopA]);
        (await CatalogHistory.ChangesBetweenAsync(readA, CatalogEntityTypes.Product, productB, T0.AddYears(-10), T0.AddYears(10), default)).ShouldBeEmpty();
        (await CatalogHistory.ValueAsOfAsync(readA, CatalogEntityTypes.Product, productB, "Price", "6.00", T0, default)).ShouldBe("6.00");
        (await CatalogHistory.HasHistorySinceAsync(readA, shopA, CatalogEntityTypes.Product, productA, DateTime.UtcNow, default)).ShouldBeTrue();

        await using var readB = TestDb.Create(_dbName, new FixedTenant(shopB));
        (await readB.CatalogChangeLogs.Select(l => l.TenantId).Distinct().ToListAsync()).ShouldBe([shopB]);
        (await CatalogHistory.HasHistorySinceAsync(readB, shopB, CatalogEntityTypes.Product, productB, DateTime.UtcNow, default)).ShouldBeFalse();
    }

    [Fact]
    public async Task OtherShopsLogRow_CannotBeChanged()
    {
        var shopA = Guid.NewGuid();
        var row = Row("Price", "1.00", "2.00", 0);
        row.TenantId = shopA;
        await AddRowsAsync(row);

        await using var other = TestDb.Create(_dbName, new FixedTenant(Guid.NewGuid()));
        other.CatalogChangeLogs.IgnoreQueryFilters().Single().NewValue = "9.00";

        await Should.ThrowAsync<InvalidOperationException>(() => other.SaveChangesAsync());
    }

    private async Task Update(Product product, decimal price)
    {
        await new UpdateProductHandler(TestDb.Create(_dbName), TestRequest.As(_user), TestFakes.Audit())
            .Handle(new UpdateProductCommand { Id = product.Id, Name = product.Name, Code = product.Code, Price = price, Category = CatalogSeed.Drink, IsActive = true }, default);
    }

    private sealed class FixedTenant(Guid id) : ICurrentTenant
    {
        public bool FilterEnabled => true;

        public Guid? TenantId => id;

        public Guid? StampTenantId => id;
    }
}
