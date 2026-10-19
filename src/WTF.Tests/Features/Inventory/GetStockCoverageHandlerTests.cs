using WTF.Api.Features.Inventory;
using WTF.Api.Features.Products.Enums;
using WTF.Tests.Features.Orders;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class GetStockCoverageHandlerTests
{
    private readonly string _db = TestDb.NewName();
    private readonly OrderSeed _data;

    public GetStockCoverageHandlerTests()
    {
        _data = new OrderSeed(_db);
    }

    private async Task<WTF.Api.Features.Inventory.DTOs.StockCoverageDto> Coverage() =>
        await new GetStockCoverageHandler(TestDb.Create(_db)).Handle(new GetStockCoverageQuery(), CancellationToken.None);

    [Fact]
    public async Task ProductWithAStockLink_IsCovered()
    {
        var latte = _data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, latte, StockSeed.Item(_db, "Milk", 100m), 200m);

        var result = await Coverage();

        result.Covered.ShouldBe(1);
        result.Products.Single().Status.ShouldBe("Covered");
    }

    [Fact]
    public async Task ProductWithNoLinks_IsMissing_AndListedFirst()
    {
        var latte = _data.AddProduct("Latte", 150m);
        _data.AddProduct("Water", 20m);
        StockSeed.Link(_db, latte, StockSeed.Item(_db, "Milk", 100m), 200m);

        var result = await Coverage();

        result.Missing.ShouldBe(1);
        result.Products.Select(p => (p.Name, p.Status)).ShouldBe([("Water", "Missing"), ("Latte", "Covered")]);
    }

    [Fact]
    public async Task InactiveLinkOrInactiveItem_DoesNotCount()
    {
        var latte = _data.AddProduct("Latte", 150m);
        var tea = _data.AddProduct("Tea", 90m);
        StockSeed.Link(_db, latte, StockSeed.Item(_db, "Milk", 100m), 200m, active: false);
        StockSeed.Link(_db, tea, StockSeed.Item(_db, "Leaves", 100m, active: false), 5m);

        (await Coverage()).Missing.ShouldBe(2);
    }

    [Fact]
    public async Task InactiveProductsAndAddOnsAreNotListed()
    {
        _data.AddProduct("Retired", 10m, isActive: false);
        _data.AddProduct("Oat", 30m, isAddOn: true);

        (await Coverage()).Products.ShouldBeEmpty();
    }

    [Fact]
    public async Task SomeSizesLinked_IsPartialWithTheMissingSizeNamed()
    {
        var latte = _data.AddProduct("Latte", 150m);
        var regular = _data.AddProduct("Regular", 0m, isAddOn: true);
        var large = _data.AddProduct("Large", 20m, isAddOn: true);
        _data.AllowAddOn(latte, regular, AddOnTypeEnum.Size);
        _data.AllowAddOn(latte, large, AddOnTypeEnum.Size);
        StockSeed.Link(_db, regular, StockSeed.Item(_db, "Regular Cup", 50m), 1m);

        var result = await Coverage();

        var row = result.Products.Single();
        row.Status.ShouldBe("Partial");
        row.MissingOptions.ShouldBe(["Size: Large"]);
        result.Partial.ShouldBe(1);
    }

    [Fact]
    public async Task EverySizeLinked_CoversAProductThatHasNoLinkOfItsOwn()
    {
        var latte = _data.AddProduct("Latte", 150m);
        var regular = _data.AddProduct("Regular", 0m, isAddOn: true);
        var large = _data.AddProduct("Large", 20m, isAddOn: true);
        _data.AllowAddOn(latte, regular, AddOnTypeEnum.Size);
        _data.AllowAddOn(latte, large, AddOnTypeEnum.Size);
        StockSeed.Link(_db, regular, StockSeed.Item(_db, "Regular Cup", 50m), 1m);
        StockSeed.Link(_db, large, StockSeed.Item(_db, "Large Cup", 50m), 1m);

        (await Coverage()).Products.Single().Status.ShouldBe("Covered");
    }

    [Fact]
    public async Task OptionalAddOnTypesAreIgnored()
    {
        var latte = _data.AddProduct("Latte", 150m);
        var syrup = _data.AddProduct("Syrup", 10m, isAddOn: true);
        var extra = _data.AddProduct("Extra shot", 30m, isAddOn: true);
        _data.AllowAddOn(latte, syrup, AddOnTypeEnum.Topping);
        _data.AllowAddOn(latte, extra, AddOnTypeEnum.Extra);
        StockSeed.Link(_db, syrup, StockSeed.Item(_db, "Syrup", 50m), 10m);

        (await Coverage()).Products.Single().Status.ShouldBe("Missing");
    }
}
