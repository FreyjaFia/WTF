using WTF.Api.Features.Reports;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Reports;

public class GetStockVarianceReportHandlerTests
{
    private static readonly DateTime InRange = Utc(2026, 3, 10, 4);

    private readonly string _dbName = TestDb.NewName();

    private GetStockVarianceReportHandler Handler() =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: "Asia/Manila"));

    private static GetStockVarianceReportQuery Query(decimal? tolerance = null, Guid? itemId = null) =>
        new() { FromDate = new DateTime(2026, 3, 10), ToDate = new DateTime(2026, 3, 11), TolerancePercent = tolerance, ItemId = itemId };

    private Guid NewItem(string name, bool active = true)
    {
        var id = Guid.NewGuid();
        using var db = TestDb.Create(_dbName);
        db.Items.Add(new Item { Id = id, Name = name, UnitName = "ml", IsActive = active });
        db.SaveChanges();
        return id;
    }

    private void Move(Guid itemId, string type, decimal before, decimal delta, DateTime at, decimal? cost = 0.15m)
    {
        using var db = TestDb.Create(_dbName);
        db.StockMovements.Add(new StockMovement
        {
            Id = Guid.NewGuid(),
            ItemId = itemId,
            MovementType = type,
            QuantityBefore = before,
            QuantityDelta = delta,
            QuantityAfter = before + delta,
            UnitCost = cost,
            CreatedAt = at,
        });
        db.SaveChanges();
    }

    [Fact]
    public async Task Handle_ReconcilesOpeningReceivedUsageAndCount()
    {
        var milk = NewItem("Milk");
        Move(milk, "AddStock", 500m, 1000m, InRange);
        Move(milk, "Sale", 1500m, -180m, InRange.AddHours(1));
        Move(milk, "Waste", 1320m, -50m, InRange.AddHours(2));
        Move(milk, "Count", 1270m, -70m, InRange.AddHours(3));

        var row = (await Handler().Handle(Query(), default)).Single();

        row.Opening.ShouldBe(500m);
        row.Received.ShouldBe(1000m);
        row.TheoreticalUsage.ShouldBe(180m);
        row.Waste.ShouldBe(50m);
        row.ActualUsage.ShouldBe(300m);
        row.Closing.ShouldBe(1200m);
        row.Variance.ShouldBe(70m);
        row.VarianceValue.ShouldBe(10.5m);
        row.Status.ShouldBe("Check");
        (row.Opening + row.Received - row.ActualUsage).ShouldBe(row.Closing);
    }

    [Fact]
    public async Task Handle_IgnoresOtherDaysInactiveItemsAndOtherItems()
    {
        var milk = NewItem("Milk");
        var retired = NewItem("Retired", active: false);
        Move(milk, "Sale", 100m, -10m, InRange.AddDays(3));
        Move(retired, "Sale", 100m, -10m, InRange);

        (await Handler().Handle(Query(), default)).ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_ItemWithNoCount_IsNotCountedAndLargestValueComesFirst()
    {
        var beans = NewItem("Beans");
        var milk = NewItem("Milk");
        Move(beans, "Sale", 100m, -10m, InRange);
        Move(milk, "Sale", 100m, -10m, InRange);
        Move(milk, "Count", 90m, -20m, InRange.AddHours(1));

        var rows = await Handler().Handle(Query(), default);

        rows.Select(r => r.ItemName).ShouldBe(["Milk", "Beans"]);
        rows[1].Status.ShouldBe("Not counted");
    }

    [Fact]
    public async Task Handle_ToleranceDecidesCheck_AndItemFilterNarrows()
    {
        var milk = NewItem("Milk");
        var beans = NewItem("Beans");
        Move(milk, "Sale", 1000m, -100m, InRange);
        Move(milk, "Count", 900m, -8m, InRange.AddHours(1));
        Move(beans, "Sale", 100m, -10m, InRange);

        (await Handler().Handle(Query(10m, milk), default)).Single().Status.ShouldBe("OK");
        (await Handler().Handle(Query(5m, milk), default)).Single().Status.ShouldBe("Check");
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(101)]
    public async Task Handle_BadTolerance_Throws(int tolerance)
    {
        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(Query(tolerance), default));

        ex.Message.ShouldBe("tolerancePercent must be between 0 and 100.");
    }
}
