using WTF.Api.Features.Audit;
using WTF.Api.Features.Audit.DTOs;
using WTF.Domain.Entities;
using WTF.Tests.Features.Items;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Audit;

public class GetAuditLogsHandlerTests
{
    private static readonly DateTime T0 = new(2026, 3, 1, 12, 0, 0, DateTimeKind.Utc);
    private readonly string _db = TestDb.NewName();
    private Guid _ana;
    private Guid _bob;

    private async Task Seed()
    {
        _ana = (await ItemSeed.User(_db, first: "Ana", last: "Cruz")).Id;
        _bob = (await ItemSeed.User(_db, first: "Bob", last: "Lee")).Id;
        await Log(_ana, "ItemCreated", "Item", "i1", T0);
        await Log(_ana, "ItemUpdated", "Item", "i1", T0.AddHours(1));
        await Log(_bob, "OrderCreated", "Order", "o1", T0.AddHours(2));
        await Log(_bob, "ItemDeleted", "Item", "i2", T0.AddHours(3));
    }

    private async Task Log(Guid userId, string action, string entityType, string entityId, DateTime at)
    {
        await using var db = TestDb.Create(_db);
        db.AuditLogs.Add(new AuditLog
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            Timestamp = at,
            IpAddress = "1.2.3.4",
            NewValues = "{}"
        });
        await db.SaveChangesAsync();
    }

    private Task<PagedResultDto<AuditLogDto>> Run(GetAuditLogsQuery q) =>
        new GetAuditLogsHandler(TestDb.Create(_db)).Handle(q, CancellationToken.None);

    [Fact]
    public async Task Handle_NoFilters_ReturnsEverythingNewestFirstWithUserNames()
    {
        await Seed();
        var r = await Run(new GetAuditLogsQuery());

        r.Items.Select(i => i.Action).ShouldBe(["ItemDeleted", "OrderCreated", "ItemUpdated", "ItemCreated"]);
        r.Items[0].UserName.ShouldBe("Bob Lee");
        r.Items[3].UserName.ShouldBe("Ana Cruz");
        r.Items[0].IpAddress.ShouldBe("1.2.3.4");
        r.TotalCount.ShouldBe(4);
    }

    [Fact]
    public async Task Handle_UserFilter_ReturnsOnlyThatUsersLogs()
    {
        await Seed();
        var r = await Run(new GetAuditLogsQuery { UserId = _ana });
        r.Items.Select(i => i.Action).ShouldBe(["ItemUpdated", "ItemCreated"]);
        r.TotalCount.ShouldBe(2);
    }

    [Fact]
    public async Task Handle_SingleAction_FiltersByAction()
    {
        await Seed();
        var r = await Run(new GetAuditLogsQuery { Action = "OrderCreated" });
        r.Items.Select(i => i.EntityId).ShouldBe(["o1"]);
    }

    [Fact]
    public async Task Handle_MultipleActions_ReturnsAnyOfThem()
    {
        await Seed();
        var r = await Run(new GetAuditLogsQuery { Actions = ["ItemCreated", "ItemDeleted"] });
        r.Items.Select(i => i.Action).ShouldBe(["ItemDeleted", "ItemCreated"]);
    }

    [Fact]
    public async Task Handle_ActionAndActions_AreCombined()
    {
        await Seed();
        var r = await Run(new GetAuditLogsQuery { Action = " ItemCreated ", Actions = ["OrderCreated", " "] });
        r.Items.Select(i => i.Action).ShouldBe(["OrderCreated", "ItemCreated"]);
    }

    [Fact]
    public async Task Handle_EntityTypeAndEntityId_Filter()
    {
        await Seed();
        (await Run(new GetAuditLogsQuery { EntityType = "Item" })).TotalCount.ShouldBe(3);
        var r = await Run(new GetAuditLogsQuery { EntityType = "Item", EntityId = "i1" });
        r.Items.Select(i => i.Action).ShouldBe(["ItemUpdated", "ItemCreated"]);
    }

    [Fact]
    public async Task Handle_DateRange_IsInclusiveAtBothEnds()
    {
        await Seed();
        var r = await Run(new GetAuditLogsQuery { FromDate = T0.AddHours(1), ToDate = T0.AddHours(2) });
        r.Items.Select(i => i.Action).ShouldBe(["OrderCreated", "ItemUpdated"]);
    }

    [Fact]
    public async Task Handle_FromDateOnly_ExcludesEarlierLogs()
    {
        await Seed();
        var r = await Run(new GetAuditLogsQuery { FromDate = T0.AddHours(3) });
        r.Items.Select(i => i.Action).ShouldBe(["ItemDeleted"]);
    }

    [Fact]
    public async Task Handle_NoPagingValues_ReturnsAllInOnePage()
    {
        await Seed();
        for (var i = 0; i < 15; i++)
        {
            await Log(_ana, "Bulk", "Item", $"b{i}", T0.AddDays(1).AddMinutes(i));
        }

        var r = await Run(new GetAuditLogsQuery());

        r.Items.Count.ShouldBe(19);
        r.TotalCount.ShouldBe(19);
        r.Page.ShouldBe(1);
        r.PageSize.ShouldBe(19);
    }

    [Fact]
    public async Task Handle_NoPagingValuesAndNoRows_ReportsPageSizeOne()
    {
        var r = await Run(new GetAuditLogsQuery());
        r.Items.ShouldBeEmpty();
        r.TotalCount.ShouldBe(0);
        r.PageSize.ShouldBe(1);
    }

    private async Task SeedMany(int count)
    {
        await ItemSeed.User(_db, _ana = Guid.NewGuid());
        for (var i = 0; i < count; i++)
        {
            await Log(_ana, "Bulk", "Item", $"b{i}", T0.AddMinutes(i));
        }
    }

    [Fact]
    public async Task Handle_PageOnly_UsesDefaultPageSizeOfTen()
    {
        await SeedMany(25);
        var r = await Run(new GetAuditLogsQuery { Page = 1 });

        r.Items.Count.ShouldBe(10);
        r.PageSize.ShouldBe(10);
        r.TotalCount.ShouldBe(25);
        r.Items[0].EntityId.ShouldBe("b24"); // newest first
    }

    [Fact]
    public async Task Handle_PageSizeOnly_StartsAtPageOne()
    {
        await SeedMany(25);
        var r = await Run(new GetAuditLogsQuery { PageSize = 5 });
        r.Page.ShouldBe(1);
        r.Items.Count.ShouldBe(5);
    }

    [Fact]
    public async Task Handle_SecondAndLastPage_SkipsPreviousRows()
    {
        await SeedMany(25);
        var second = await Run(new GetAuditLogsQuery { Page = 2, PageSize = 10 });
        second.Items.Select(i => i.EntityId).ShouldBe(Enumerable.Range(5, 10).Reverse().Select(i => $"b{i}"));

        var last = await Run(new GetAuditLogsQuery { Page = 3, PageSize = 10 });
        last.Items.Count.ShouldBe(5);
        last.Items[^1].EntityId.ShouldBe("b0");
    }

    [Fact]
    public async Task Handle_PageSizeAboveMax_IsCappedAtOneHundred()
    {
        await SeedMany(120);
        var r = await Run(new GetAuditLogsQuery { Page = 1, PageSize = 500 });
        r.PageSize.ShouldBe(100);
        r.Items.Count.ShouldBe(100);
        r.TotalCount.ShouldBe(120);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    public async Task Handle_NonPositivePageSize_UsesDefault(int size)
    {
        await SeedMany(25);
        var r = await Run(new GetAuditLogsQuery { Page = 1, PageSize = size });
        r.PageSize.ShouldBe(10);
        r.Items.Count.ShouldBe(10);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-3)]
    public async Task Handle_NonPositivePage_FallsBackToPageOne(int page)
    {
        await SeedMany(25);
        var r = await Run(new GetAuditLogsQuery { Page = page, PageSize = 10 });
        r.Page.ShouldBe(1);
        r.Items[0].EntityId.ShouldBe("b24");
    }

    [Fact]
    public async Task Handle_PagePastTheEnd_ReturnsEmptyItemsWithCorrectTotal()
    {
        await SeedMany(25);
        var r = await Run(new GetAuditLogsQuery { Page = 9, PageSize = 10 });
        r.Items.ShouldBeEmpty();
        r.TotalCount.ShouldBe(25);
        r.Page.ShouldBe(9);
    }

    [Fact]
    public async Task Handle_FilterWithPaging_TotalCountReflectsFilter()
    {
        await Seed();
        var r = await Run(new GetAuditLogsQuery { EntityType = "Item", Page = 1, PageSize = 2 });
        r.Items.Count.ShouldBe(2);
        r.TotalCount.ShouldBe(3);
    }
}
