using WTF.Api.Features.Reports;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Reports;

public class GetProductSalesReportHandlerTests
{
    private const int FixedType = 1;
    private const int MixMatchType = 2;
    private const int PromotionsCategory = -1;
    private const int FixedSub = -101;
    private const int MixMatchSub = -102;

    private readonly string _dbName = TestDb.NewName();

    private GetProductSalesReportHandler Handler(string? timeZone = "Asia/Manila") =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: timeZone));

    private static GetProductSalesReportQuery Query(int? category = null, int? subCategory = null) =>
        new()
        {
            FromDate = new DateTime(2026, 3, 10),
            ToDate = new DateTime(2026, 3, 10),
            CategoryId = category,
            SubCategoryId = subCategory,
        };

    private static readonly DateTime Noon = Utc(2026, 3, 10, 4);

    /// <summary>Burger (food/burgers) 100 x3 = 300, Fries (food/sides) 40 x1 = 40, Cola (drinks) 20 x2 = 40,
    /// a fixed bundle (60 x1) and a mix and match bundle (30 x2 = 60), all completed.</summary>
    private async Task SeedCatalogSales()
    {
        await using var db = TestDb.Create(_dbName);
        Basics(db);
        var burger = Product(db, "Burger", 100m, FoodCategory, BurgerSub);
        var fries = Product(db, "Fries", 40m, FoodCategory, SideSub);
        var cola = Product(db, "Cola", 20m, DrinksCategory);
        var fixedPromo = Promotion(db, "Burger Combo", FixedType);
        var mixPromo = Promotion(db, "Any Two", MixMatchType);

        var order = Order(db, Noon);
        Item(db, order, burger, 2);
        Item(db, order, fries, 1);
        Item(db, order, cola, 2);
        Bundle(db, order, fixedPromo, 1, 60m);
        Bundle(db, order, mixPromo, 2, 30m);
        var order2 = Order(db, Noon);
        Item(db, order2, burger, 1);
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Handle_NoOrders_ReturnsEmptyList()
    {
        var rows = await Handler().Handle(Query(), default);

        rows.ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_NoFilter_ReturnsProductsAndBundlesOrderedByRevenueDescending()
    {
        await SeedCatalogSales();

        var rows = await Handler().Handle(Query(), default);

        rows.Select(r => r.ProductName).First().ShouldBe("Burger");
        rows.Select(r => r.Revenue).ShouldBe(rows.Select(r => r.Revenue).OrderByDescending(r => r));
        rows.Count.ShouldBe(5);
        var burger = rows.Single(r => r.ProductName == "Burger");
        burger.QuantitySold.ShouldBe(3);
        burger.Revenue.ShouldBe(300m);
        burger.CategoryName.ShouldBe("Food");
        burger.SubCategoryName.ShouldBe("Burgers");
        burger.RevenuePercent.ShouldBe(300m / 500m * 100m, 0.0001m);
        rows.Sum(r => r.RevenuePercent).ShouldBe(100m, 0.0001m);
        rows.Single(r => r.ProductName == "Cola").SubCategoryName.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_Bundles_ReportPromotionsCategoryAndTypeLabel()
    {
        await SeedCatalogSales();

        var rows = await Handler().Handle(Query(PromotionsCategory), default);

        rows.Count.ShouldBe(2);
        var fixedRow = rows.Single(r => r.ProductName == "Burger Combo");
        fixedRow.CategoryName.ShouldBe("Promotions");
        fixedRow.SubCategoryName.ShouldBe("Fixed Bundle");
        fixedRow.QuantitySold.ShouldBe(1);
        fixedRow.Revenue.ShouldBe(60m);
        var mixRow = rows.Single(r => r.ProductName == "Any Two");
        mixRow.SubCategoryName.ShouldBe("Mix & Match");
        mixRow.QuantitySold.ShouldBe(2);
        mixRow.Revenue.ShouldBe(60m);
    }

    [Fact]
    public async Task Handle_CategoryFilter_ReturnsOnlyThatCategoryAndNoBundles()
    {
        await SeedCatalogSales();

        var rows = await Handler().Handle(Query(FoodCategory), default);

        rows.Select(r => r.ProductName).OrderBy(n => n).ShouldBe(["Burger", "Fries"]);
        rows.Sum(r => r.RevenuePercent).ShouldBe(100m, 0.0001m);
    }

    [Fact]
    public async Task Handle_ProductSubCategoryFilter_ReturnsOnlyMatchingProductsAndNoBundles()
    {
        await SeedCatalogSales();

        var rows = await Handler().Handle(Query(subCategory: SideSub), default);

        rows.ShouldHaveSingleItem().ProductName.ShouldBe("Fries");
    }

    [Fact]
    public async Task Handle_FixedBundleSubCategoryFilter_ReturnsOnlyFixedBundles()
    {
        await SeedCatalogSales();

        var rows = await Handler().Handle(Query(subCategory: FixedSub), default);

        rows.ShouldHaveSingleItem().ProductName.ShouldBe("Burger Combo");
    }

    [Fact]
    public async Task Handle_MixMatchSubCategoryFilter_ReturnsOnlyMixAndMatchBundles()
    {
        await SeedCatalogSales();

        var rows = await Handler().Handle(Query(PromotionsCategory, MixMatchSub), default);

        rows.ShouldHaveSingleItem().ProductName.ShouldBe("Any Two");
    }

    [Fact]
    public async Task Handle_ProductCategoryWithBundleSubCategory_ReturnsNothing()
    {
        await SeedCatalogSales();

        var rows = await Handler().Handle(Query(FoodCategory, FixedSub), default);

        rows.ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_AddOnsAndDiscountedPrice_AreIncludedInParentProductRevenue()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var burger = Product(db, "Burger", 100m);
            var cheese = Product(db, "Cheese", 20m);
            var bacon = Product(db, "Bacon", 30m);
            var order = Order(db, Noon);
            var parent = Item(db, order, burger, 2, price: 90m); // discounted unit price
            Item(db, order, cheese, 1, parent: parent);
            Item(db, order, bacon, 1, parent: parent);
            db.ProductAddOnPriceOverrides.Add(new ProductAddOnPriceOverride
            {
                Id = Guid.NewGuid(), ProductId = burger.Id, AddOnId = bacon.Id, Price = 5m, IsActive = true,
            });
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(), default);

        // Add-ons are not their own rows; (90 + 20 + 5) * 2
        var row = rows.ShouldHaveSingleItem();
        row.ProductName.ShouldBe("Burger");
        row.QuantitySold.ShouldBe(2);
        row.Revenue.ShouldBe(230m);
    }

    [Fact]
    public async Task Handle_ItemsBelongingToABundle_AreNotCountedAsProducts()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var burger = Product(db, "Burger", 100m);
            var promo = Promotion(db, "Combo", FixedType);
            var order = Order(db, Noon);
            var bundleItem = Item(db, order, burger, 1);
            bundleItem.BundlePromotionId = promo.Id;
            Bundle(db, order, promo, 1, 80m);
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(), default);

        var row = rows.ShouldHaveSingleItem();
        row.ProductName.ShouldBe("Combo");
        row.Revenue.ShouldBe(80m);
    }

    [Fact]
    public async Task Handle_NonCompletedOrdersAndOtherPromotionTypes_AreExcluded()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var burger = Product(db, "Burger", 100m);
            var fixedPromo = Promotion(db, "Combo", FixedType);
            var discountPromo = Promotion(db, "Half Off", 3);
            foreach (var status in new[] { Cancelled, Refunded, Pending })
            {
                var o = Order(db, Noon, status);
                Item(db, o, burger, 5);
                Bundle(db, o, fixedPromo, 5, 50m);
            }

            var ok = Order(db, Noon);
            Item(db, ok, burger, 1);
            Bundle(db, ok, discountPromo, 1, 10m);
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(), default);

        var row = rows.ShouldHaveSingleItem();
        row.ProductName.ShouldBe("Burger");
        row.QuantitySold.ShouldBe(1);
    }

    [Fact]
    public async Task Handle_OrdersAroundLocalMidnight_UseRequestTimeZoneForTheRange()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var burger = Product(db, "Burger", 100m);
            Sale(db, burger, Utc(2026, 3, 9, 15, 59), 1m);   // 3/9 Manila: before
            Item(db, Order(db, Utc(2026, 3, 9, 16, 1)), burger, 1);   // 3/10 Manila: in
            Item(db, Order(db, Utc(2026, 3, 10, 15, 59)), burger, 1); // 3/10 Manila: in
            Item(db, Order(db, Utc(2026, 3, 10, 16, 1)), burger, 1);  // 3/11 Manila: after
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(), default);

        rows.ShouldHaveSingleItem().QuantitySold.ShouldBe(2);
    }

    [Fact]
    public async Task Handle_SameProductOnManyOrders_IsAggregatedIntoOneRow()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var burger = Product(db, "Burger", 100m);
            Item(db, Order(db, Noon), burger, 1);
            Item(db, Order(db, Noon), burger, 4);
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(), default);

        var row = rows.ShouldHaveSingleItem();
        row.QuantitySold.ShouldBe(5);
        row.Revenue.ShouldBe(500m);
        row.RevenuePercent.ShouldBe(100m);
    }
}
