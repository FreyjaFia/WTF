using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

public class HeldOrderBulkDatabaseTests
{
    [SqlFact]
    public async Task Approve_ASecondReviewerWhoLoadedTheOrderFirst_FindsItAlreadyDecided()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var product = await SqlSeed.ProductAsync(database, user.Id, "Latte", 160m);
        var orderId = await DbOrderSeed.OrderAsync(database, user.Id, OrderStatusEnum.PendingReview);
        await DbOrderSeed.LineAsync(database, orderId, product.Id, price: 150m);

        await using var first = database.CreateContext();
        await using var second = database.CreateContext();
        var staleCopy = await second.Orders.SingleAsync(o => o.Id == orderId);
        var firstOrder = await first.Orders.SingleAsync(o => o.Id == orderId);

        await Approver(first).ApproveAsync(firstOrder, user.Id, default);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Approver(second).ApproveAsync(staleCopy, user.Id, default));
        ex.Message.ShouldBe("Only orders waiting for review can be approved.");
        await using var check = database.CreateContext();
        (await check.Orders.SingleAsync()).StatusId.ShouldBe((int)OrderStatusEnum.Completed);
    }

    [SqlFact]
    public async Task BulkApprove_AgainstRealTables_ApprovesHeldOrdersAndLeavesCompletedOnesAlone()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var product = await SqlSeed.ProductAsync(database, user.Id, "Latte", 160m);
        var held = await DbOrderSeed.OrderAsync(database, user.Id, OrderStatusEnum.PendingReview);
        await DbOrderSeed.LineAsync(database, held, product.Id, price: 150m);
        var done = await DbOrderSeed.OrderAsync(database, user.Id, OrderStatusEnum.Completed);
        await DbOrderSeed.LineAsync(database, done, product.Id, price: 160m);

        await using var db = database.CreateContext();
        var handler = new BulkApproveHeldOrdersHandler(db, TestRequest.As(user.Id, AppRoles.Admin), Approver(db), TestFakes.Audit());
        var result = await handler.Handle(new BulkApproveHeldOrdersCommand(new HeldOrderFilter(Ids: [held, done]), false), default);

        result.Count.ShouldBe(1);
        result.Items.Single(i => i.Id == done).Outcome.ShouldBe(BulkApproveOutcomes.SkippedNotHeld);
        await using var check = database.CreateContext();
        (await check.Orders.SingleAsync(o => o.Id == held)).StatusId.ShouldBe((int)OrderStatusEnum.Completed);
    }

    private static HeldOrderApprover Approver(WTF.Domain.Data.WTFDbContext db) =>
        new(db, TestFakes.Hub(), TestFakes.Audit(), TestFakes.Conversations(), TestFakes.Stock(db));
}
