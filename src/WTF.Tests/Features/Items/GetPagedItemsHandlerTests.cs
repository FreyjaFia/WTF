using WTF.Api.Features.Items;
using WTF.Api.Features.Items.DTOs;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Items;

public class GetPagedItemsHandlerTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();

    private async Task<Item> Seed(string name, decimal qty, decimal? warning = null, decimal? critical = null, decimal? cost = null, bool active = true)
    {
        var item = await ItemSeed.Item(_db, _userId, name, qty: qty, cost: cost, active: active);
        await using var db = TestDb.Create(_db);
        var tracked = await db.Items.FindAsync(item.Id);
        tracked!.WarningQuantity = warning;
        tracked.CriticalQuantity = critical;
        await db.SaveChangesAsync();
        return tracked;
    }

    private async Task SeedStatuses()
    {
        await Seed("Ok Item", 100, warning: 20, critical: 5);
        await Seed("Warning Item", 15, warning: 20, critical: 5);
        await Seed("Critical Item", 3, warning: 20, critical: 5);
        await Seed("Untracked Item", 0);
    }

    private Task<WTF.Api.Common.DTOs.PagedResultDto<ItemDto>> Run(GetPagedItemsQuery q) =>
        new GetPagedItemsHandler(TestDb.Create(_db)).Handle(q, CancellationToken.None);

    [Fact]
    public async Task Handle_Default_ReturnsEveryItemByNameWithStatusCounts()
    {
        await SeedStatuses();

        var result = await Run(new GetPagedItemsQuery());

        result.Items.Select(i => i.Name).ShouldBe(["Critical Item", "Ok Item", "Untracked Item", "Warning Item"]);
        result.TotalCount.ShouldBe(4);
        result.Facets!["ok"].ShouldBe(2);
        result.Facets["warning"].ShouldBe(1);
        result.Facets["critical"].ShouldBe(1);
    }

    [Fact]
    public async Task Handle_IncludesInactiveItems()
    {
        await Seed("Old Salt", 10, active: false);

        (await Run(new GetPagedItemsQuery())).TotalCount.ShouldBe(1);
    }

    [Fact]
    public async Task Handle_StockStatusFilter_TrimsTheListButNotTheChipCounts()
    {
        await SeedStatuses();

        var result = await Run(new GetPagedItemsQuery(StockStatuses: "critical,warning"));

        result.Items.Select(i => i.Name).ShouldBe(["Critical Item", "Warning Item"]);
        result.TotalCount.ShouldBe(2);
        result.Facets!["ok"].ShouldBe(2);
    }

    [Fact]
    public async Task Handle_AllChipsOrNoneTicked_MeansEveryItem()
    {
        await SeedStatuses();

        (await Run(new GetPagedItemsQuery(StockStatuses: "ok,warning,critical"))).TotalCount.ShouldBe(4);
        (await Run(new GetPagedItemsQuery(StockStatuses: "nonsense"))).TotalCount.ShouldBe(4);
    }

    [Fact]
    public async Task Handle_Search_NarrowsTheChipCountsToo()
    {
        await SeedStatuses();

        var result = await Run(new GetPagedItemsQuery(SearchTerm: "Warning"));

        result.Items.Select(i => i.Name).ShouldBe(["Warning Item"]);
        result.Facets!["warning"].ShouldBe(1);
        result.Facets["ok"].ShouldBe(0);
    }

    [Fact]
    public async Task Handle_SortByStatus_PutsCriticalFirstAcrossPages()
    {
        await SeedStatuses();

        var first = await Run(new GetPagedItemsQuery(SortBy: "status", SortDirection: "asc", PageSize: 2));
        var second = await Run(new GetPagedItemsQuery(SortBy: "status", SortDirection: "asc", PageSize: 2, Page: 2));

        first.Items.Select(i => i.Name).ShouldBe(["Critical Item", "Warning Item"]);
        second.Items.Select(i => i.Name).ShouldBe(["Ok Item", "Untracked Item"]);
    }

    [Fact]
    public async Task Handle_SortByStockAndCost_UsesTheWholeList()
    {
        await Seed("A", 5, cost: 9m);
        await Seed("B", 1, cost: 2m);
        await Seed("C", 3);

        (await Run(new GetPagedItemsQuery(SortBy: "stock", SortDirection: "asc"))).Items.Select(i => i.Name).ShouldBe(["B", "C", "A"]);
        (await Run(new GetPagedItemsQuery(SortBy: "cost", SortDirection: "desc"))).Items.Select(i => i.Name).ShouldBe(["A", "B", "C"]);
    }

    [Fact]
    public async Task Handle_PageBeyondTheEnd_ReturnsTheLastPage()
    {
        await SeedStatuses();

        var result = await Run(new GetPagedItemsQuery(Page: 9, PageSize: 3));

        result.Page.ShouldBe(2);
        result.Items.Count.ShouldBe(1);
    }

    [Fact]
    public async Task Handle_Empty_ReturnsNoItemsWithZeroCounts()
    {
        var result = await Run(new GetPagedItemsQuery());

        result.Items.ShouldBeEmpty();
        result.Facets!["ok"].ShouldBe(0);
    }
}
