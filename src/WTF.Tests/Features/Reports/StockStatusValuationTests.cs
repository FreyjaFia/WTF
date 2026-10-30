using WTF.Api.Features.Reports;
using WTF.Tests.Features.Inventory;
using WTF.Tests.Features.Items;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Reports;

public class StockStatusValuationTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();

    [Fact]
    public async Task TheStockStatusReport_ValuesStockAtTheAverageCost()
    {
        await ItemSeed.User(_db, _userId);
        StockSeed.Item(_db, "Milk", 1000m, cost: 0.20m, averageCost: 0.175m);

        var rows = await new GetStockStatusReportHandler(TestDb.Create(_db))
            .Handle(new GetStockStatusReportQuery(), CancellationToken.None);

        var row = rows.Single();
        row.CostPrice.ShouldBe(0.175m);
        row.StockValue.ShouldBe(175m);
    }

    [Fact]
    public async Task AnItemWithNoAverageYet_IsValuedAtItsLastCost()
    {
        await ItemSeed.User(_db, _userId);
        StockSeed.Item(_db, "Cups", 10m, cost: 4m);

        var rows = await new GetStockStatusReportHandler(TestDb.Create(_db))
            .Handle(new GetStockStatusReportQuery(), CancellationToken.None);

        rows.Single().StockValue.ShouldBe(40m);
    }
}
