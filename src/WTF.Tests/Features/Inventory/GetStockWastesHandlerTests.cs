using WTF.Api.Common.Auth;
using WTF.Api.Features.Inventory.Waste;
using WTF.Api.Features.Inventory.Waste.DTOs;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class GetStockWastesHandlerTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _staffId;
    private readonly Guid _otherId;
    private readonly Guid _milkId;
    private readonly Guid _cupId;
    private readonly int _spillId;
    private readonly int _expiredId;

    public GetStockWastesHandlerTests()
    {
        _staffId = WasteSeed.User(_db, AppRoles.Cashier, first: "Ana", last: "Staff");
        _otherId = WasteSeed.User(_db, AppRoles.StockManager, first: "Ben", last: "Stock");
        _milkId = StockSeed.Item(_db, "Oat Milk", 1000m);
        _cupId = StockSeed.Item(_db, "Cup", 50m);
        _spillId = WasteSeed.Reason(_db, "Spilled or dropped");
        _expiredId = WasteSeed.Reason(_db, "Expired or spoiled");
    }

    [Fact]
    public async Task NoFilters_ReturnsNewestFirstWithNamesAndBalances()
    {
        var older = WasteSeed.Entry(_db, _milkId, _spillId, _staffId, 100m, createdAt: new DateTime(2026, 3, 10, 1, 0, 0, DateTimeKind.Utc));
        var newer = WasteSeed.Entry(_db, _cupId, _expiredId, _otherId, 2m, createdAt: new DateTime(2026, 3, 11, 1, 0, 0, DateTimeKind.Utc), reasonName: "Expired or spoiled");

        var result = await Handle(new GetStockWastesQuery(null, null, null, null, null, null));

        result.TotalCount.ShouldBe(2);
        result.Items.Select(i => i.Id).ShouldBe([newer, older]);
        var first = result.Items[0];
        first.ItemName.ShouldBe("Cup");
        first.ReasonName.ShouldBe("Expired or spoiled");
        first.CreatedByName.ShouldContain("Ben");
        first.Status.ShouldBe("Recorded");
        first.QuantityBefore.ShouldBe(1000m);
        first.QuantityAfter.ShouldBe(998m);
    }

    [Fact]
    public async Task DateRange_CoversWholeDaysFromFromToTo()
    {
        var day = new DateTime(2026, 3, 10, 0, 0, 0, DateTimeKind.Utc);
        WasteSeed.Entry(_db, _milkId, _spillId, _staffId, createdAt: day.AddSeconds(-1));
        var atFrom = WasteSeed.Entry(_db, _milkId, _spillId, _staffId, createdAt: day);
        WasteSeed.Entry(_db, _milkId, _spillId, _staffId, createdAt: day.AddDays(1));

        var result = await Handle(new GetStockWastesQuery(day, day, null, null, null, null));

        result.Items.Select(i => i.Id).ShouldBe([atFrom]);
    }

    [Fact]
    public async Task ItemReasonAndStaffFilters_NarrowTheList()
    {
        var match = WasteSeed.Entry(_db, _milkId, _spillId, _staffId);
        WasteSeed.Entry(_db, _cupId, _spillId, _staffId);
        WasteSeed.Entry(_db, _milkId, _expiredId, _staffId);
        WasteSeed.Entry(_db, _milkId, _spillId, _otherId);

        var result = await Handle(new GetStockWastesQuery(null, null, _milkId, _spillId, null, _staffId));

        result.TotalCount.ShouldBe(1);
        result.Items.Single().Id.ShouldBe(match);
    }

    [Theory]
    [InlineData("PendingReview")]
    [InlineData("pendingreview")]
    [InlineData("2")]
    public async Task StatusFilter_AcceptsNameOrNumber(string status)
    {
        WasteSeed.Entry(_db, _milkId, _spillId, _staffId);
        var pending = WasteSeed.Entry(_db, _milkId, _spillId, _staffId, status: StockWasteStatuses.PendingReview);

        var result = await Handle(new GetStockWastesQuery(null, null, null, null, status, null));

        result.Items.Select(i => i.Id).ShouldBe([pending]);
        result.Items[0].Status.ShouldBe("PendingReview");
        result.Items[0].RequiresReview.ShouldBeTrue();
    }

    [Fact]
    public async Task UnknownStatus_Throws()
    {
        var ex = await Should.ThrowAsync<InvalidOperationException>(
            () => Handle(new GetStockWastesQuery(null, null, null, null, "Lost", null)));

        ex.Message.ShouldBe("Unknown waste status.");
    }

    [Fact]
    public async Task PendingCount_IgnoresTheFilters()
    {
        WasteSeed.Entry(_db, _milkId, _spillId, _staffId, status: StockWasteStatuses.PendingReview);
        WasteSeed.Entry(_db, _cupId, _spillId, _staffId, status: StockWasteStatuses.PendingReview);
        WasteSeed.Entry(_db, _cupId, _spillId, _staffId, status: StockWasteStatuses.Confirmed);

        var result = await Handle(new GetStockWastesQuery(null, null, _cupId, null, "Confirmed", null));

        result.TotalCount.ShouldBe(1);
        result.PendingCount.ShouldBe(2);
    }

    [Fact]
    public async Task Paging_SkipsAndTakes()
    {
        var start = new DateTime(2026, 3, 1, 0, 0, 0, DateTimeKind.Utc);
        var ids = Enumerable.Range(0, 5)
            .Select(i => WasteSeed.Entry(_db, _milkId, _spillId, _staffId, createdAt: start.AddHours(i)))
            .ToList();

        var result = await Handle(new GetStockWastesQuery(null, null, null, null, null, null, Page: 2, PageSize: 2));

        result.TotalCount.ShouldBe(5);
        result.Items.Select(i => i.Id).ShouldBe([ids[2], ids[1]]);
    }

    [Fact]
    public async Task Paging_BadValuesAreClamped()
    {
        for (var i = 0; i < 3; i++)
        {
            WasteSeed.Entry(_db, _milkId, _spillId, _staffId);
        }

        var zeroSize = await Handle(new GetStockWastesQuery(null, null, null, null, null, null, Page: 0, PageSize: 0));
        var hugeSize = await Handle(new GetStockWastesQuery(null, null, null, null, null, null, Page: -5, PageSize: 10_000));

        zeroSize.Items.Count.ShouldBe(1);
        hugeSize.Items.Count.ShouldBe(3);
    }

    [Fact]
    public async Task PendingCountHandler_CountsOnlyPendingReview()
    {
        WasteSeed.Entry(_db, _milkId, _spillId, _staffId, status: StockWasteStatuses.PendingReview);
        WasteSeed.Entry(_db, _milkId, _spillId, _staffId, status: StockWasteStatuses.Disputed);
        WasteSeed.Entry(_db, _milkId, _spillId, _staffId, status: StockWasteStatuses.Reversed);

        var result = await new GetPendingWasteCountHandler(TestDb.Create(_db)).Handle(new GetPendingWasteCountQuery(), default);

        result.Count.ShouldBe(1);
    }

    private Task<PagedStockWasteDto> Handle(GetStockWastesQuery query) =>
        new GetStockWastesHandler(TestDb.Create(_db)).Handle(query, default);
}
