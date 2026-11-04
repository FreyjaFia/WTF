using WTF.Api.Common.Auth;
using WTF.Api.Features.Dashboard;
using WTF.Api.Features.Inventory;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Dashboard;

public class GetDashboardProfitTests
{
    private static readonly TimeZoneInfo Manila = TimeZoneInfo.FindSystemTimeZoneById("Asia/Manila");

    private readonly string _dbName = TestDb.NewName();

    private GetDashboardHandler Handler(string role = AppRoles.Admin) =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), role, "Asia/Manila"));

    private static DateTime YesterdayNoonUtc() =>
        TimeZoneInfo.ConvertTimeToUtc(
            DateTime.SpecifyKind(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Manila).Date.AddDays(-1).AddHours(12), DateTimeKind.Unspecified),
            Manila);

    private static void Move(WTFDbContext db, Guid itemId, string type, decimal delta, DateTime at, Order? order = null, Product? product = null) =>
        db.StockMovements.Add(new StockMovement
        {
            Id = Guid.NewGuid(),
            ItemId = itemId,
            MovementType = type,
            QuantityDelta = delta,
            QuantityBefore = 1000m,
            QuantityAfter = 1000m + delta,
            UnitCost = 0.1m,
            ReferenceType = order is null ? StockMovementTypes.StockWasteReference : StockMovementTypes.OrderReference,
            ReferenceId = order?.Id ?? Guid.NewGuid(),
            ProductId = product?.Id,
            CreatedAt = at,
            CreatedBy = StaffA
        });

    private async Task SeedAsync()
    {
        await using var db = TestDb.Create(_dbName);
        Basics(db);
        var at = YesterdayNoonUtc();
        var milkId = Guid.NewGuid();
        db.Items.Add(new Item { Id = milkId, Name = "Milk", UnitName = "ml", IsActive = true, CurrentQuantity = 1000m, AverageCost = 0.1m });
        var latte = Product(db, "Latte", 150m, DrinksCategory);
        var order = Order(db, at);
        Item(db, order, latte, 2, 150m);
        Move(db, milkId, StockMovementTypes.Sale, -400m, at, order, latte);
        Move(db, milkId, StockMovementTypes.Waste, -100m, at.AddHours(1));
        Move(db, milkId, StockMovementTypes.Count, -70m, at.AddHours(2));
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task TheOwnerTiles_AddUpSalesCostWasteAndCountDifferences()
    {
        await SeedAsync();

        var profit = (await Handler().Handle(new GetDashboardQuery("yesterday", null, null), default)).Profit;

        profit.ShouldNotBeNull();
        profit.NetSales.ShouldBe(300m);
        profit.ActualProfit.ShouldBe(243m);
        profit.MarginPercent.ShouldBe(81m);
        profit.CostStatus.ShouldBe("Known");
        profit.WasteCost.ShouldBe(10m);
        profit.WastePercent.ShouldBe(20m);
        profit.TopVarianceItem.ShouldBe("Milk");
        profit.TopVarianceValue.ShouldBe(7m);
        profit.StockValue.ShouldBe(100m);
    }

    [Theory]
    [InlineData(AppRoles.SuperAdmin)]
    [InlineData(AppRoles.Admin)]
    [InlineData(AppRoles.AdminViewer)]
    public async Task TheCostRolesGetTheTiles(string role)
    {
        await SeedAsync();

        (await Handler(role).Handle(new GetDashboardQuery("yesterday", null, null), default)).Profit.ShouldNotBeNull();
    }

    [Theory]
    [InlineData(AppRoles.Cashier)]
    [InlineData(AppRoles.StockManager)]
    [InlineData(AppRoles.ItemManager)]
    public async Task RolesThatCannotReadCostsGetNoTiles(string role)
    {
        await SeedAsync();

        (await Handler(role).Handle(new GetDashboardQuery("yesterday", null, null), default)).Profit.ShouldBeNull();
    }

    [Fact]
    public async Task ADayWithNothingGivesEmptyTilesNotAnError()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            await db.SaveChangesAsync();
        }

        var profit = (await Handler().Handle(new GetDashboardQuery("yesterday", null, null), default)).Profit;

        profit.ShouldNotBeNull();
        profit.NetSales.ShouldBe(0m);
        profit.MarginPercent.ShouldBeNull();
        profit.WastePercent.ShouldBeNull();
        profit.TopVarianceItem.ShouldBeNull();
    }
}
