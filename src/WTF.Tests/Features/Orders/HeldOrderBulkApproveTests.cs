using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Orders;

public class HeldOrderBulkApproveTests
{
    private static readonly Guid TenantA = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
    private static readonly Guid TenantB = Guid.Parse("bbbbbbbb-0000-0000-0000-000000000002");

    private readonly Guid _adminId = Guid.NewGuid();
    private readonly string _dbName = TestDb.NewName();
    private readonly IAuditService _audit = TestFakes.Audit();
    private Product? _product;

    private HeldOrderApprover Approver(WTFDbContext db) =>
        new(db, TestFakes.Hub(), _audit, TestFakes.Conversations(), TestFakes.Stock(db));

    private BulkApproveHeldOrdersHandler Bulk(IHeldOrderApprover? approver = null, WTFDbContext? db = null)
    {
        db ??= TestDb.Create(_dbName);
        return new BulkApproveHeldOrdersHandler(db, TestRequest.As(_adminId, AppRoles.Admin, "Asia/Manila"), approver ?? Approver(db), _audit);
    }

    private GetHeldOrdersHandler List(WTFDbContext? db = null) =>
        new(db ?? TestDb.Create(_dbName), TestRequest.As(_adminId, AppRoles.Admin, "Asia/Manila"));

    private Guid SeedHeld(
        decimal quoted,
        double hoursOld = 1,
        Guid? by = null,
        string[]? holdCodes = null,
        string[]? noteCodes = null,
        decimal seniorDiscount = 0m,
        Guid? tenantId = null,
        string? dbName = null)
    {
        using var db = TestDb.Create(dbName ?? _dbName);
        if (!db.Users.Any())
        {
            Basics(db);
        }

        _product ??= Product(db, "Latte", 160m);
        if (!db.Products.Any(p => p.Id == _product.Id))
        {
            db.Products.Add(_product);
        }

        var order = Order(db, DateTime.UtcNow.AddHours(-hoursOld), 6, by ?? StaffA);
        order.QuotedTotal = quoted;
        order.ReviewReasons = "Price changed";
        if (tenantId.HasValue)
        {
            order.TenantId = tenantId.Value;
        }

        var item = Item(db, order, _product, 1, quoted + seniorDiscount);
        if (seniorDiscount > 0m)
        {
            item.SeniorPwdDiscount = seniorDiscount;
        }

        var sort = 0;
        foreach (var code in holdCodes ?? ["PriceChanged"])
        {
            db.OrderReviewReasons.Add(Reason(order, code, ReviewSeverityEnum.Hold, sort++, tenantId));
        }

        foreach (var code in noteCodes ?? [])
        {
            db.OrderReviewReasons.Add(Reason(order, code, ReviewSeverityEnum.Note, sort++, tenantId));
        }

        db.SaveChanges();
        return order.Id;
    }

    private static OrderReviewReason Reason(Order order, string code, ReviewSeverityEnum severity, int sort, Guid? tenantId) => new()
    {
        Id = Guid.NewGuid(),
        OrderId = order.Id,
        SortOrder = sort,
        Code = code,
        Severity = (byte)severity,
        Text = code + " text",
        TenantId = tenantId ?? Guid.Empty
    };

    private async Task<int> StatusOf(Guid id)
    {
        await using var db = TestDb.Create(_dbName);
        return (await db.Orders.AsNoTracking().SingleAsync(o => o.Id == id)).StatusId;
    }

    private static HeldOrderFilter All() => new();

    [Fact]
    public async Task Preview_CountsAndTotalsWhatWouldBeApproved_AndChangesNothing()
    {
        var a = SeedHeld(100m);
        var b = SeedHeld(250.50m);

        var result = await Bulk().Handle(new BulkApproveHeldOrdersCommand(All(), true), default);

        result.Preview.ShouldBeTrue();
        result.Count.ShouldBe(2);
        result.TotalAmount.ShouldBe(350.50m);
        result.Items.Select(i => i.Outcome).ShouldAllBe(o => o == BulkApproveOutcomes.WouldApprove);
        (await StatusOf(a)).ShouldBe((int)OrderStatusEnum.PendingReview);
        (await StatusOf(b)).ShouldBe((int)OrderStatusEnum.PendingReview);
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!, default, default, default, default);
    }

    [Fact]
    public async Task Approve_CompletesEachOrder_AndAuditsEachOneAndOneSummary()
    {
        var a = SeedHeld(100m);
        var b = SeedHeld(250m);

        var result = await Bulk().Handle(new BulkApproveHeldOrdersCommand(All(), false), default);

        result.Preview.ShouldBeFalse();
        result.Count.ShouldBe(2);
        result.TotalAmount.ShouldBe(350m);
        (await StatusOf(a)).ShouldBe((int)OrderStatusEnum.Completed);
        (await StatusOf(b)).ShouldBe((int)OrderStatusEnum.Completed);
        await _audit.Received(2).LogAsync(AuditAction.OrderReviewApproved, AuditEntityType.Order, Arg.Any<string>(), Arg.Any<object?>(), Arg.Any<object?>(), _adminId, Arg.Any<CancellationToken>());
        await _audit.Received(1).LogAsync(AuditAction.OrderReviewBulkApproved, AuditEntityType.Order, "bulk", Arg.Any<object?>(), Arg.Any<object?>(), _adminId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Approve_ByReasonCode_OnlyTakesTheMatchingHolds_NotNotes()
    {
        var price = SeedHeld(100m, holdCodes: ["PriceChanged"]);
        var inactive = SeedHeld(100m, holdCodes: ["ProductInactive"]);
        var noteOnly = SeedHeld(100m, holdCodes: ["ProductInactive"], noteCodes: ["PriceChanged"]);

        var result = await Bulk().Handle(new BulkApproveHeldOrdersCommand(new HeldOrderFilter(["PriceChanged"]), false), default);

        result.Count.ShouldBe(1);
        (await StatusOf(price)).ShouldBe((int)OrderStatusEnum.Completed);
        (await StatusOf(inactive)).ShouldBe((int)OrderStatusEnum.PendingReview);
        (await StatusOf(noteOnly)).ShouldBe((int)OrderStatusEnum.PendingReview);
    }

    [Fact]
    public async Task Approve_ByCashier_AndAgedOnly_NarrowTheList()
    {
        var anaOld = SeedHeld(100m, hoursOld: 80, by: StaffA);
        var anaNew = SeedHeld(100m, hoursOld: 2, by: StaffA);
        var benOld = SeedHeld(100m, hoursOld: 80, by: StaffB);

        var result = await Bulk().Handle(new BulkApproveHeldOrdersCommand(new HeldOrderFilter(CashierId: StaffA, AgedOnly: true), false), default);

        result.Count.ShouldBe(1);
        (await StatusOf(anaOld)).ShouldBe((int)OrderStatusEnum.Completed);
        (await StatusOf(anaNew)).ShouldBe((int)OrderStatusEnum.PendingReview);
        (await StatusOf(benOld)).ShouldBe((int)OrderStatusEnum.PendingReview);
    }

    [Fact]
    public async Task Approve_ByDateRange_UsesTheShopsLocalDay()
    {
        // 17:00 UTC on 9 March is 01:00 on 10 March in Manila.
        Guid lateNight;
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            await db.SaveChangesAsync();
        }

        lateNight = SeedHeld(100m);
        await using (var db = TestDb.Create(_dbName))
        {
            var order = await db.Orders.SingleAsync(o => o.Id == lateNight);
            order.CreatedAt = Utc(2026, 3, 9, 17);
            await db.SaveChangesAsync();
        }

        var onTheNinth = await Bulk().Handle(
            new BulkApproveHeldOrdersCommand(new HeldOrderFilter(FromDate: new DateTime(2026, 3, 9), ToDate: new DateTime(2026, 3, 9)), true), default);
        var onTheTenth = await Bulk().Handle(
            new BulkApproveHeldOrdersCommand(new HeldOrderFilter(FromDate: new DateTime(2026, 3, 10), ToDate: new DateTime(2026, 3, 10)), true), default);

        onTheNinth.Count.ShouldBe(0);
        onTheTenth.Count.ShouldBe(1);
    }

    [Fact]
    public async Task Approve_SkipsASeniorPwdHold_UnlessTheFilterNamesThatCode()
    {
        var plain = SeedHeld(100m, holdCodes: ["PriceChanged"]);
        var senior = SeedHeld(80m, holdCodes: ["SeniorPwdDisabled"], seniorDiscount: 20m);

        var preview = await Bulk().Handle(new BulkApproveHeldOrdersCommand(All(), true), default);
        preview.Count.ShouldBe(1);
        preview.SkippedCount.ShouldBe(1);
        preview.Items.Single(i => i.Id == senior).Outcome.ShouldBe(BulkApproveOutcomes.SkippedSeniorPwd);

        var run = await Bulk().Handle(new BulkApproveHeldOrdersCommand(All(), false), default);
        run.Count.ShouldBe(1);
        (await StatusOf(plain)).ShouldBe((int)OrderStatusEnum.Completed);
        (await StatusOf(senior)).ShouldBe((int)OrderStatusEnum.PendingReview);

        var onPurpose = await Bulk().Handle(new BulkApproveHeldOrdersCommand(new HeldOrderFilter(["SeniorPwdDisabled"]), false), default);
        onPurpose.Count.ShouldBe(1);
        (await StatusOf(senior)).ShouldBe((int)OrderStatusEnum.Completed);
    }

    [Fact]
    public async Task Approve_APickedSeniorPwdOrder_IsStillSkippedWithoutTheCodeInTheFilter()
    {
        var senior = SeedHeld(80m, holdCodes: ["SeniorPwdIdMissing"], seniorDiscount: 20m);

        var result = await Bulk().Handle(new BulkApproveHeldOrdersCommand(new HeldOrderFilter(Ids: [senior]), false), default);

        result.Count.ShouldBe(0);
        result.Items.Single().Outcome.ShouldBe(BulkApproveOutcomes.SkippedSeniorPwd);
        (await StatusOf(senior)).ShouldBe((int)OrderStatusEnum.PendingReview);
    }

    [Fact]
    public async Task Approve_NeverTouchesAnOrderThatIsNotHeld()
    {
        var held = SeedHeld(100m);
        Guid done;
        await using (var db = TestDb.Create(_dbName))
        {
            var order = Order(db, DateTime.UtcNow.AddHours(-3));
            done = order.Id;
            Item(db, order, _product!, 1, 160m);
            await db.SaveChangesAsync();
        }

        var result = await Bulk().Handle(new BulkApproveHeldOrdersCommand(new HeldOrderFilter(Ids: [held, done, Guid.NewGuid()]), false), default);

        result.Count.ShouldBe(1);
        result.SkippedCount.ShouldBe(2);
        result.Items.Count(i => i.Outcome == BulkApproveOutcomes.SkippedNotHeld).ShouldBe(2);
        (await StatusOf(done)).ShouldBe((int)OrderStatusEnum.Completed);
    }

    [Fact]
    public async Task Approve_AFailureOnOneOrder_DoesNotStopTheOthers()
    {
        var first = SeedHeld(100m, hoursOld: 5);
        var broken = SeedHeld(100m, hoursOld: 4);
        var last = SeedHeld(100m, hoursOld: 3);
        var db = TestDb.Create(_dbName);
        var flaky = new FailingApprover(Approver(db), broken);

        var result = await Bulk(flaky, db).Handle(new BulkApproveHeldOrdersCommand(All(), false), default);

        result.Count.ShouldBe(2);
        result.FailedCount.ShouldBe(1);
        result.Items.Single(i => i.Id == broken).Outcome.ShouldBe(BulkApproveOutcomes.Failed);
        (await StatusOf(first)).ShouldBe((int)OrderStatusEnum.Completed);
        (await StatusOf(broken)).ShouldBe((int)OrderStatusEnum.PendingReview);
        (await StatusOf(last)).ShouldBe((int)OrderStatusEnum.Completed);
    }

    [Fact]
    public async Task Approve_AnOrderDecidedByAnotherReviewerFirst_IsReportedNotApprovedTwice()
    {
        var id = SeedHeld(100m);
        var db = TestDb.Create(_dbName);
        var racing = new DecidedFirstApprover(Approver(db), id, () =>
        {
            using var other = TestDb.Create(_dbName);
            var order = other.Orders.Single(o => o.Id == id);
            order.StatusId = (int)OrderStatusEnum.Cancelled;
            other.SaveChanges();
        });

        var result = await Bulk(racing, db).Handle(new BulkApproveHeldOrdersCommand(All(), false), default);

        result.Count.ShouldBe(0);
        result.Items.Single().Outcome.ShouldBe(BulkApproveOutcomes.SkippedNotHeld);
        (await StatusOf(id)).ShouldBe((int)OrderStatusEnum.Cancelled);
    }

    [Fact]
    public async Task TwoTenants_EachOnlySeesAndApprovesItsOwnHeldOrders()
    {
        var mine = SeedHeld(100m, tenantId: TenantA);
        var theirs = SeedHeld(100m, tenantId: TenantB);
        await using (var fix = TestDb.Create(_dbName))
        {
            foreach (var user in fix.Users)
            {
                user.TenantId = TenantA;
            }

            foreach (var product in fix.Products)
            {
                product.TenantId = TenantA;
            }

            await fix.SaveChangesAsync();
        }

        await using var asTenantA = TestDb.Create(_dbName, new FakeTenant(TenantA));
        var listed = await List(asTenantA).Handle(new GetHeldOrdersQuery(All()), default);
        listed.Items.Select(i => i.Id).ShouldBe([mine]);

        await using var again = TestDb.Create(_dbName, new FakeTenant(TenantA));
        var result = await Bulk(null, again).Handle(new BulkApproveHeldOrdersCommand(new HeldOrderFilter(Ids: [mine, theirs]), false), default);

        result.Count.ShouldBe(1);
        result.Items.Single(i => i.Id == theirs).Outcome.ShouldBe(BulkApproveOutcomes.SkippedNotHeld);
        (await StatusOf(theirs)).ShouldBe((int)OrderStatusEnum.PendingReview);
        (await StatusOf(mine)).ShouldBe((int)OrderStatusEnum.Completed);
    }

    [Fact]
    public async Task List_FlagsAnOrderOlderThanTwoDays_AndCountsWhatIsWaiting()
    {
        var old = SeedHeld(120m, hoursOld: 80);
        var fresh = SeedHeld(30m, hoursOld: 5, holdCodes: ["ProductInactive"]);

        var all = await List().Handle(new GetHeldOrdersQuery(All()), default);

        all.AgedAfterDays.ShouldBe(2);
        all.TotalCount.ShouldBe(2);
        all.TotalAmount.ShouldBe(150m);
        all.AgedCount.ShouldBe(1);
        all.AgedAmount.ShouldBe(120m);
        var oldRow = all.Items.Single(i => i.Id == old);
        oldRow.IsAged.ShouldBeTrue();
        oldRow.AgeDays.ShouldBe(3);
        oldRow.ReasonCodes.ShouldBe(["PriceChanged"]);
        all.Items.Single(i => i.Id == fresh).IsAged.ShouldBeFalse();

        var agedOnly = await List().Handle(new GetHeldOrdersQuery(new HeldOrderFilter(AgedOnly: true)), default);
        agedOnly.Items.Select(i => i.Id).ShouldBe([old]);

        var byCode = await List().Handle(new GetHeldOrdersQuery(new HeldOrderFilter(["ProductInactive"])), default);
        byCode.Items.Select(i => i.Id).ShouldBe([fresh]);
    }

    [Fact]
    public async Task PagedOrders_CarryTheAgedFlagForTheBanner()
    {
        var old = SeedHeld(120m, hoursOld: 80);
        var fresh = SeedHeld(30m, hoursOld: 5);

        var page = await new GetPagedOrdersHandler(TestDb.Create(_dbName), TestRequest.As(_adminId))
            .Handle(new GetPagedOrdersQuery(OrderStatusEnum.PendingReview), default);

        page.Items.Single(o => o.Id == old).IsAged.ShouldBeTrue();
        page.Items.Single(o => o.Id == old).HeldDays.ShouldBe(3);
        page.Items.Single(o => o.Id == fresh).IsAged.ShouldBeFalse();
    }

    [Fact]
    public void CashiersAndViewers_DoNotHoldTheOverridePermission_SoTheRoutesAnswer403()
    {
        SystemRolePermissions().ShouldNotContain(AppRoles.Cashier);
        SystemRolePermissions().ShouldNotContain(AppRoles.AdminViewer);
        SystemRolePermissions().ShouldContain(AppRoles.Admin);
    }

    private static string[] SystemRolePermissions() =>
        WTF.Api.Common.Auth.Permissions.SystemRolePermissions.RolesWith("orders.override");

    private sealed class FailingApprover(IHeldOrderApprover inner, Guid failing) : IHeldOrderApprover
    {
        public Task ApproveAsync(Order order, Guid userId, CancellationToken cancellationToken) =>
            order.Id == failing
                ? throw new InvalidOperationException("The stock could not be taken.")
                : inner.ApproveAsync(order, userId, cancellationToken);
    }

    private sealed class DecidedFirstApprover(IHeldOrderApprover inner, Guid raced, Action decideElsewhere) : IHeldOrderApprover
    {
        public Task ApproveAsync(Order order, Guid userId, CancellationToken cancellationToken)
        {
            if (order.Id == raced)
            {
                decideElsewhere();
                throw new InvalidOperationException("Only orders waiting for review can be approved.");
            }

            return inner.ApproveAsync(order, userId, cancellationToken);
        }
    }

    private sealed class FakeTenant(Guid tenantId) : ICurrentTenant
    {
        public bool FilterEnabled => true;

        public Guid? TenantId => tenantId;

        public Guid? StampTenantId => tenantId;
    }
}
