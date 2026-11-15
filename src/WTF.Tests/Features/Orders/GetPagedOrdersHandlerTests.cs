using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.Enums;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Orders;

public class GetPagedOrdersHandlerTests
{
    private readonly OrderSeed _data = new(TestDb.NewName());

    private GetPagedOrdersHandler Handler() => new(_data.Open(), TestFakes.Features);

    private void SeedOrders(int count)
    {
        var start = DateTime.UtcNow.AddDays(-1);
        for (var i = 0; i < count; i++)
        {
            _data.AddOrder(createdAt: start.AddMinutes(i), orderNumber: 5000 + i);
        }
    }

    private void SetSource(Guid orderId, OrderSourceEnum source)
    {
        using var db = _data.Open();
        db.Orders.Single(o => o.Id == orderId).Source = (byte)source;
        db.SaveChanges();
    }

    [Fact]
    public async Task Handle_SourceFilter_ReturnsOnlyOrdersFromThatSource()
    {
        var shop = _data.AddOrder(orderNumber: 7001);
        var online = _data.AddOrder(orderNumber: 7002);
        var online2 = _data.AddOrder(orderNumber: 7003);
        SetSource(online, OrderSourceEnum.CustomerLink);
        SetSource(online2, OrderSourceEnum.CustomerLink);

        var link = await Handler().Handle(
            new GetPagedOrdersQuery(Source: OrderSourceEnum.CustomerLink), CancellationToken.None);
        var pos = await Handler().Handle(new GetPagedOrdersQuery(Source: OrderSourceEnum.Pos), CancellationToken.None);
        var all = await Handler().Handle(new GetPagedOrdersQuery(), CancellationToken.None);

        link.Items.Select(o => o.Id).ShouldBe([online2, online], ignoreOrder: true);
        link.TotalCount.ShouldBe(2);
        pos.Items.Select(o => o.Id).ShouldBe([shop]);
        all.TotalCount.ShouldBe(3);
    }

    [Fact]
    public async Task Handle_SourceFilter_StillHidesOrdersWaitingForApproval()
    {
        var waiting = _data.AddOrder(OrderStatusEnum.PendingApproval, orderNumber: 7101);
        var accepted = _data.AddOrder(orderNumber: 7102);
        SetSource(waiting, OrderSourceEnum.CustomerLink);
        SetSource(accepted, OrderSourceEnum.CustomerLink);

        var result = await Handler().Handle(
            new GetPagedOrdersQuery(Source: OrderSourceEnum.CustomerLink), CancellationToken.None);

        result.Items.Select(o => o.Id).ShouldBe([accepted]);
    }

    [Fact]
    public async Task Handle_NoOrders_ReturnsEmptyPageWithEchoedPaging()
    {
        var result = await Handler().Handle(new GetPagedOrdersQuery(Page: 3, PageSize: 10), CancellationToken.None);

        result.Items.ShouldBeEmpty();
        result.TotalCount.ShouldBe(0);
        result.Page.ShouldBe(3);
        result.PageSize.ShouldBe(10);
    }

    [Fact]
    public async Task Handle_FirstPage_ReturnsNewestFirstWithTotalCount()
    {
        SeedOrders(5);

        var result = await Handler().Handle(new GetPagedOrdersQuery(PageSize: 2), CancellationToken.None);

        result.TotalCount.ShouldBe(5);
        result.Items.Select(o => o.OrderNumber).ShouldBe([5004, 5003]);
    }

    [Fact]
    public async Task Handle_SecondAndLastPage_ReturnRemainingOrders()
    {
        SeedOrders(5);

        var second = await Handler().Handle(new GetPagedOrdersQuery(Page: 2, PageSize: 2), CancellationToken.None);
        var last = await Handler().Handle(new GetPagedOrdersQuery(Page: 3, PageSize: 2), CancellationToken.None);
        var beyond = await Handler().Handle(new GetPagedOrdersQuery(Page: 4, PageSize: 2), CancellationToken.None);

        second.Items.Select(o => o.OrderNumber).ShouldBe([5002, 5001]);
        last.Items.Select(o => o.OrderNumber).ShouldBe([5000]);
        last.TotalCount.ShouldBe(5);
        beyond.Page.ShouldBe(3);
        beyond.Items.Select(o => o.OrderNumber).ShouldBe([5000]);
        beyond.TotalCount.ShouldBe(5);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-4)]
    public async Task Handle_PageBelowOne_IsClampedToOne(int page)
    {
        SeedOrders(3);

        var result = await Handler().Handle(new GetPagedOrdersQuery(Page: page, PageSize: 2), CancellationToken.None);

        result.Page.ShouldBe(1);
        result.Items.Select(o => o.OrderNumber).ShouldBe([5002, 5001]);
    }

    [Theory]
    [InlineData(0, 20)]
    [InlineData(-1, 20)]
    [InlineData(101, 100)]
    [InlineData(5000, 100)]
    [InlineData(100, 100)]
    [InlineData(7, 7)]
    public async Task Handle_PageSize_IsClamped(int requested, int expected)
    {
        SeedOrders(1);

        var result = await Handler().Handle(new GetPagedOrdersQuery(PageSize: requested), CancellationToken.None);

        result.PageSize.ShouldBe(expected);
    }

    [Fact]
    public async Task Handle_PageSizeAboveMax_ReturnsAtMostOneHundredItems()
    {
        SeedOrders(105);

        var result = await Handler().Handle(new GetPagedOrdersQuery(PageSize: 500), CancellationToken.None);

        result.Items.Count.ShouldBe(100);
        result.TotalCount.ShouldBe(105);
    }

    [Fact]
    public async Task Handle_StatusAndCustomerFilters_CombineAndCountMatchesOnly()
    {
        var ana = _data.AddCustomer("Ana", "Cruz");
        var match = _data.AddOrder(OrderStatusEnum.Completed, ana);
        _data.AddOrder(OrderStatusEnum.Pending, ana);
        _data.AddOrder(OrderStatusEnum.Completed);

        var result = await Handler().Handle(
            new GetPagedOrdersQuery(OrderStatusEnum.Completed, ana), CancellationToken.None);

        result.TotalCount.ShouldBe(1);
        result.Items.Single().Id.ShouldBe(match);
    }

    [Fact]
    public async Task Handle_ExcludeFinalized_HidesCompletedAndRefunded()
    {
        var pending = _data.AddOrder();
        _data.AddOrder(OrderStatusEnum.Completed);
        _data.AddOrder(OrderStatusEnum.Refunded);

        var result = await Handler().Handle(new GetPagedOrdersQuery(ExcludeFinalized: true), CancellationToken.None);

        result.Items.Single().Id.ShouldBe(pending);
        result.TotalCount.ShouldBe(1);
    }

    [Fact]
    public async Task Handle_SearchByOrderNumber_MatchesSubstring()
    {
        _data.AddOrder(orderNumber: 1234);
        _data.AddOrder(orderNumber: 4321);
        _data.AddOrder(orderNumber: 999);

        var result = await Handler().Handle(new GetPagedOrdersQuery(SearchTerm: "2"), CancellationToken.None);

        result.Items.Select(o => o.OrderNumber).ShouldBe([1234, 4321], ignoreOrder: true);
    }

    [Theory]
    [InlineData("ana cruz")]
    [InlineData("CRUZ ANA")]
    [InlineData("  Cruz  ")]
    [InlineData("na cr")]
    public async Task Handle_SearchByCustomerName_IsCaseInsensitiveInEitherNameOrder(string term)
    {
        var ana = _data.AddCustomer("Ana", "Cruz");
        var ben = _data.AddCustomer("Ben", "Lim");
        var anaOrder = _data.AddOrder(customerId: ana, orderNumber: 7);
        _data.AddOrder(customerId: ben, orderNumber: 8);
        _data.AddOrder(orderNumber: 9);

        var result = await Handler().Handle(new GetPagedOrdersQuery(SearchTerm: term), CancellationToken.None);

        result.Items.Single().Id.ShouldBe(anaOrder);
        result.TotalCount.ShouldBe(1);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Handle_BlankSearchTerm_IsIgnored(string? term)
    {
        SeedOrders(3);

        var result = await Handler().Handle(new GetPagedOrdersQuery(SearchTerm: term), CancellationToken.None);

        result.TotalCount.ShouldBe(3);
    }

    [Fact]
    public async Task Handle_SearchWithNoMatch_ReturnsEmpty()
    {
        SeedOrders(3);

        var result = await Handler().Handle(new GetPagedOrdersQuery(SearchTerm: "zzz"), CancellationToken.None);

        result.Items.ShouldBeEmpty();
        result.TotalCount.ShouldBe(0);
    }

    [Fact]
    public async Task Handle_OrderDto_IncludesOverrideInfoItemsAndCustomerName()
    {
        var burger = _data.AddProduct("Burger", 100);
        var cheese = _data.AddProduct("Cheese", 15, isAddOn: true);
        var ana = _data.AddCustomer("Ana", "Cruz");
        var orderId = _data.AddOrder(OrderStatusEnum.Completed, ana);
        var parent = _data.AddLine(orderId, burger, 2, price: 90m, originalPrice: 100m, promoLabel: "10% off");
        _data.AddLine(orderId, cheese, 1, price: 10m, parentId: parent);
        await using (var db = _data.Open())
        {
            var o = await db.Orders.FindAsync(orderId);
            o!.OverrideReason = "fix";
            o.OverriddenAt = new DateTime(2026, 5, 6, 7, 8, 9, DateTimeKind.Utc);
            await db.SaveChangesAsync();
        }

        var dto = (await Handler().Handle(new GetPagedOrdersQuery(), CancellationToken.None)).Items.Single();

        dto.CustomerName.ShouldBe("Ana Cruz");
        dto.OverrideReason.ShouldBe("fix");
        dto.OverriddenAt.ShouldBe(new DateTime(2026, 5, 6, 7, 8, 9, DateTimeKind.Utc));
        dto.TotalAmount.ShouldBe(200m);
        dto.Items.Single().PromoLabel.ShouldBe("10% off");
        dto.Items.Single().AddOns.Single().ProductName.ShouldBe("Cheese");
    }

    [Fact]
    public async Task Handle_StatusFilter_TotalsAndPagesCountOnlyThatStatus()
    {
        var start = DateTime.UtcNow.AddDays(-1);
        for (var i = 0; i < 7; i++)
        {
            _data.AddOrder(i % 2 == 0 ? OrderStatusEnum.Completed : OrderStatusEnum.Pending, createdAt: start.AddMinutes(i), orderNumber: 8000 + i);
        }

        var result = await Handler().Handle(
            new GetPagedOrdersQuery(Statuses: [(int)OrderStatusEnum.Completed], PageSize: 3), CancellationToken.None);

        result.TotalCount.ShouldBe(4);
        result.Items.Count.ShouldBe(3);
        result.Items.ShouldAllBe(o => o.Status == OrderStatusEnum.Completed);
    }

    [Fact]
    public async Task Handle_SeveralStatuses_ReturnsAnyOfThem()
    {
        _data.AddOrder(OrderStatusEnum.Completed, orderNumber: 8101);
        _data.AddOrder(OrderStatusEnum.Cancelled, orderNumber: 8102);
        _data.AddOrder(OrderStatusEnum.Pending, orderNumber: 8103);

        var result = await Handler().Handle(
            new GetPagedOrdersQuery(Statuses: [(int)OrderStatusEnum.Completed, (int)OrderStatusEnum.Cancelled]), CancellationToken.None);

        result.TotalCount.ShouldBe(2);
    }

    [Fact]
    public async Task Handle_DateRange_FiltersBeforePagingAndCounting()
    {
        var now = DateTime.UtcNow;
        _data.AddOrder(createdAt: now.AddDays(-40), orderNumber: 8201);
        _data.AddOrder(createdAt: now.AddDays(-5), orderNumber: 8202);
        _data.AddOrder(createdAt: now.AddHours(-1), orderNumber: 8203);

        var result = await Handler().Handle(
            new GetPagedOrdersQuery(From: new DateTimeOffset(now.AddDays(-7), TimeSpan.Zero), To: new DateTimeOffset(now, TimeSpan.Zero)),
            CancellationToken.None);

        result.Items.Select(o => o.OrderNumber).ShouldBe([8203, 8202]);
        result.TotalCount.ShouldBe(2);
    }

    [Fact]
    public async Task Handle_SortByOrderNumber_FollowsDirectionAcrossPages()
    {
        SeedOrders(5);

        var asc = await Handler().Handle(
            new GetPagedOrdersQuery(SortBy: "orderNumber", SortDirection: "asc", PageSize: 2, Page: 2), CancellationToken.None);
        var desc = await Handler().Handle(
            new GetPagedOrdersQuery(SortBy: "orderNumber", SortDirection: "desc", PageSize: 2), CancellationToken.None);

        asc.Items.Select(o => o.OrderNumber).ShouldBe([5002, 5003]);
        desc.Items.Select(o => o.OrderNumber).ShouldBe([5004, 5003]);
    }

    [Fact]
    public async Task Handle_UnknownSortColumn_FallsBackToNewestFirst()
    {
        SeedOrders(3);

        var result = await Handler().Handle(new GetPagedOrdersQuery(SortBy: "nonsense; drop table"), CancellationToken.None);

        result.Items.Select(o => o.OrderNumber).ShouldBe([5002, 5001, 5000]);
    }

    [Fact]
    public async Task Handle_SameTimestamp_NeverRepeatsARowAcrossPages()
    {
        var at = DateTime.UtcNow.AddHours(-1);
        for (var i = 0; i < 7; i++)
        {
            _data.AddOrder(createdAt: at, orderNumber: 8300 + i);
        }

        var seen = new List<Guid>();
        for (var page = 1; page <= 4; page++)
        {
            var result = await Handler().Handle(new GetPagedOrdersQuery(Page: page, PageSize: 2), CancellationToken.None);
            seen.AddRange(result.Items.Select(o => o.Id));
        }

        seen.Count.ShouldBe(7);
        seen.Distinct().Count().ShouldBe(7);
    }

    [Fact]
    public async Task Handle_PageAfterTheLast_ReturnsTheLastPage()
    {
        SeedOrders(5);

        var result = await Handler().Handle(new GetPagedOrdersQuery(Page: 9, PageSize: 2), CancellationToken.None);

        result.Page.ShouldBe(3);
        result.Items.Count.ShouldBe(1);
        result.TotalCount.ShouldBe(5);
    }

    [Fact]
    public async Task Handle_Facets_CountEachStatusIgnoringTheStatusFilterButNotTheDateRange()
    {
        var now = DateTime.UtcNow;
        _data.AddOrder(OrderStatusEnum.Completed, createdAt: now.AddHours(-2), orderNumber: 8401);
        _data.AddOrder(OrderStatusEnum.Completed, createdAt: now.AddHours(-3), orderNumber: 8402);
        _data.AddOrder(OrderStatusEnum.Cancelled, createdAt: now.AddHours(-4), orderNumber: 8403);
        _data.AddOrder(OrderStatusEnum.Completed, createdAt: now.AddDays(-20), orderNumber: 8404);
        _data.AddOrder(OrderStatusEnum.PendingApproval, createdAt: now.AddHours(-1), orderNumber: 8405);

        var result = await Handler().Handle(
            new GetPagedOrdersQuery(
                Statuses: [(int)OrderStatusEnum.Cancelled],
                From: new DateTimeOffset(now.AddDays(-1), TimeSpan.Zero)),
            CancellationToken.None);

        result.TotalCount.ShouldBe(1);
        result.Facets.ShouldNotBeNull();
        result.Facets![((int)OrderStatusEnum.Completed).ToString()].ShouldBe(2);
        result.Facets[((int)OrderStatusEnum.Cancelled).ToString()].ShouldBe(1);
        result.Facets["all"].ShouldBe(3);
    }
}
