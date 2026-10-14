using WTF.Api.Features.Reports;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Reports;

public class GetStockStatusReportHandlerTests
{
    private readonly string _dbName = TestDb.NewName();

    private static Item NewItem(string name, decimal quantity, decimal? warning, decimal? critical, decimal? cost, bool active = true) =>
        new()
        {
            Id = Guid.NewGuid(),
            Name = name,
            UnitName = "pc",
            CurrentQuantity = quantity,
            WarningQuantity = warning,
            CriticalQuantity = critical,
            CostPrice = cost,
            IsActive = active,
        };

    [Fact]
    public async Task Handle_NoItems_ReturnsEmptyList()
    {
        var rows = await new GetStockStatusReportHandler(TestDb.Create(_dbName))
            .Handle(new GetStockStatusReportQuery(), default);

        rows.ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_ItemsAreLabelledAndSortedWorstFirstThenByName()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            db.Items.AddRange(
                NewItem("Zucchini", 100m, 20m, 5m, 2m),
                NewItem("Apple", 100m, 20m, 5m, null),
                NewItem("Milk", 15m, 20m, 5m, 10m),
                NewItem("Lids", 4m, 20m, 5m, 1m),
                NewItem("Cups", 0m, 20m, 5m, 3m),
                NewItem("Sleeves", -3m, 20m, 5m, 3m),
                NewItem("Retired", 0m, 20m, 5m, 3m, active: false));
            await db.SaveChangesAsync();
        }

        var rows = await new GetStockStatusReportHandler(TestDb.Create(_dbName))
            .Handle(new GetStockStatusReportQuery(), default);

        rows.Select(r => r.ItemName).ShouldBe(["Cups", "Sleeves", "Lids", "Milk", "Apple", "Zucchini"]);
        rows.Select(r => r.Status).ShouldBe(["Out of stock", "Out of stock", "Critical", "Warning", "OK", "OK"]);
    }

    [Fact]
    public async Task Handle_StockValue_UsesCostAndNeverGoesNegative()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            db.Items.AddRange(
                NewItem("Milk", 15m, null, null, 10m),
                NewItem("Free", 8m, null, null, null),
                NewItem("Owed", -4m, null, null, 10m));
            await db.SaveChangesAsync();
        }

        var rows = await new GetStockStatusReportHandler(TestDb.Create(_dbName))
            .Handle(new GetStockStatusReportQuery(), default);

        rows.Single(r => r.ItemName == "Milk").StockValue.ShouldBe(150m);
        rows.Single(r => r.ItemName == "Free").StockValue.ShouldBe(0m);
        rows.Single(r => r.ItemName == "Owed").StockValue.ShouldBe(0m);
    }
}
