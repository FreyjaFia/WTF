using MediatR;
using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Orders;

public class UnsyncedOrderTests
{
    private static readonly DateTime Now = new(2026, 6, 10, 12, 0, 0, DateTimeKind.Utc);

    private readonly Guid _cashierId = Guid.NewGuid();
    private readonly Guid _adminId = Guid.NewGuid();
    private readonly string _dbName = TestDb.NewName();
    private readonly IAuditService _audit = TestFakes.Audit();

    private ISender Sender(Guid actingUserId, string role)
    {
        var db = TestDb.Create(_dbName);
        var accessor = TestRequest.As(actingUserId, role);
        var create = new CreateOrderHandler(db, accessor, TestFakes.Hub(), _audit, TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(db));
        var sender = Substitute.For<ISender>();
        sender.Send(Arg.Any<IRequest<OrderDto>>(), Arg.Any<CancellationToken>())
            .Returns(call => create.Handle((CreateOrderCommand)call.Arg<IRequest<OrderDto>>(), call.Arg<CancellationToken>()));
        var sync = new SyncOfflineOrdersHandler(db, sender, accessor);
        sender.Send(Arg.Any<IRequest<List<OfflineSyncResultDto>>>(), Arg.Any<CancellationToken>())
            .Returns(call => sync.Handle((SyncOfflineOrdersCommand)call.Arg<IRequest<List<OfflineSyncResultDto>>>(), call.Arg<CancellationToken>()));
        return sender;
    }

    private Task<UnsyncedOrderRetryResultDto?> Retry(Guid id)
    {
        var db = TestDb.Create(_dbName);
        var handler = new RetryUnsyncedOrderHandler(db, TestRequest.As(_adminId, AppRoles.Admin), Sender(_adminId, AppRoles.Admin), _audit);
        return handler.Handle(new RetryUnsyncedOrderCommand(id), CancellationToken.None);
    }

    private Task<UnsyncedOrderDetailDto?> NoteOnly(Guid id)
    {
        var db = TestDb.Create(_dbName);
        var handler = new NoteOnlyUnsyncedOrderHandler(db, TestRequest.As(_adminId, AppRoles.Admin), TestFakes.Hub(), _audit);
        return handler.Handle(new NoteOnlyUnsyncedOrderCommand(id), CancellationToken.None);
    }

    private Task<UnsyncedOrderDetailDto?> Discard(Guid id, string reason)
    {
        var db = TestDb.Create(_dbName);
        var handler = new DiscardUnsyncedOrderHandler(db, TestRequest.As(_adminId, AppRoles.Admin), _audit);
        return handler.Handle(new DiscardUnsyncedOrderCommand(id, reason), CancellationToken.None);
    }

    private async Task<List<OfflineSyncResultDto>> CashierSyncs(params CreateOrderCommand[] orders)
    {
        return await Sender(_cashierId, AppRoles.Cashier).Send(new SyncOfflineOrdersCommand([.. orders]));
    }

    private static CreateOrderCommand Order(string localId, params OrderItemRequestDto[] items) => new()
    {
        Status = OrderStatusEnum.Completed,
        Items = [.. items],
        OfflineLocalId = localId,
        CreatedAt = Now,
        PaymentMethod = PaymentMethodEnum.Cash,
        AmountReceived = 500m,
        ExpectedTotal = 150m,
    };

    private static OrderItemRequestDto Line(Guid productId, int qty, decimal quoted) => new(productId, qty, [], null, null, quoted);

    private async Task<Guid> SeedProduct(string name, decimal price)
    {
        await using var db = TestDb.Create(_dbName);
        var product = new Product { Id = Guid.NewGuid(), Name = name, Price = price, IsActive = true, Code = name, CreatedAt = Now, CreatedBy = _adminId };
        db.Products.Add(product);
        await db.SaveChangesAsync();
        return product.Id;
    }

    private async Task<UnsyncedOrder> LoadRow(string localId)
    {
        await using var db = TestDb.Create(_dbName);
        return await db.UnsyncedOrders.AsNoTracking().SingleAsync(u => u.OfflineLocalId == localId);
    }

    private async Task<Guid> FailOne(string localId = "OFF-1-aaaa")
    {
        var unknown = Guid.NewGuid();
        var results = await CashierSyncs(Order(localId, Line(unknown, 2, 50m), Line(unknown, 1, 50m)));
        results.Single().Error.ShouldNotBeNull();
        return (await LoadRow(localId)).Id;
    }

    [Fact]
    public async Task Sync_AnOrderThatCannotBeSaved_LeavesAnOpenRowAndTheSameResultForTheDevice()
    {
        var results = await CashierSyncs(Order("OFF-1-aaaa", Line(Guid.NewGuid(), 2, 50m)));

        results.Single().Error.ShouldNotBeNull();
        results.Single().OrderId.ShouldBeNull();
        var row = await LoadRow("OFF-1-aaaa");
        row.StatusId.ShouldBe((byte)UnsyncedOrderStatusEnum.Open);
        row.CashierUserId.ShouldBe(_cashierId);
        row.ErrorText.ShouldBe(results.Single().Error);
        row.ErrorCode.ShouldBe("NotFound");
        row.QuotedTotal.ShouldBe(150m);
        row.DeviceCreatedAt.ShouldBe(Now);
        row.QuotedOrderJson.ShouldContain("OFF-1-aaaa");
    }

    [Fact]
    public async Task Sync_ASavedOrder_LeavesNoRow()
    {
        var latte = await SeedProduct("Latte", 100m);

        var results = await CashierSyncs(Order("OFF-1-aaaa", Line(latte, 1, 100m)));

        results.Single().Error.ShouldBeNull();
        await using var db = TestDb.Create(_dbName);
        (await db.UnsyncedOrders.CountAsync()).ShouldBe(0);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public async Task Sync_AnOrderWithoutAQueueNumber_LeavesNoRow(string? localId)
    {
        var results = await CashierSyncs(Order(localId!, Line(Guid.NewGuid(), 1, 50m)));

        results.Single().Error.ShouldNotBeNull();
        await using var db = TestDb.Create(_dbName);
        (await db.UnsyncedOrders.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Sync_TheSameOrderFailingTwice_KeepsOneRow()
    {
        await FailOne();
        await FailOne();

        await using var db = TestDb.Create(_dbName);
        (await db.UnsyncedOrders.CountAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task Sync_TheOrderResentAfterTheFix_SavesAndResolvesItsOpenRow()
    {
        var product = Guid.NewGuid();
        await CashierSyncs(Order("OFF-1-aaaa", Line(product, 1, 100m)));
        await using (var db = TestDb.Create(_dbName))
        {
            db.Products.Add(new Product { Id = product, Name = "Latte", Price = 100m, IsActive = true, Code = "L", CreatedAt = Now, CreatedBy = _adminId });
            await db.SaveChangesAsync();
        }

        var again = await CashierSyncs(Order("OFF-1-aaaa", Line(product, 1, 100m)));

        again.Single().Error.ShouldBeNull();
        var row = await LoadRow("OFF-1-aaaa");
        row.StatusId.ShouldBe((byte)UnsyncedOrderStatusEnum.Resolved);
        row.Resolution.ShouldBe((byte)UnsyncedOrderResolutionEnum.Retried);
        row.ResultingOrderId.ShouldBe(again.Single().OrderId);
        row.ResolvedAt.ShouldNotBeNull();
    }

    [Fact]
    public async Task Sync_AnOrderTooBigToStore_IsStillRefusedWithTheSameResultAndLeavesNoRow()
    {
        var huge = Order("OFF-1-aaaa", Line(Guid.NewGuid(), 1, 50m)) with { Note = new string('x', 70_000) };

        var results = await CashierSyncs(huge);

        results.Single().Error.ShouldNotBeNull();
        await using var db = TestDb.Create(_dbName);
        (await db.UnsyncedOrders.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Sync_WhenTheRowCannotBeWritten_TheSyncResultIsStillReturned()
    {
        // No signed-in user: the cashier cannot be named, so nothing is stored, and the device still hears the error.
        var db = TestDb.Create(_dbName);
        var sender = Substitute.For<ISender>();
        sender.Send(Arg.Any<IRequest<OrderDto>>(), Arg.Any<CancellationToken>())
            .Returns<OrderDto>(_ => throw new InvalidOperationException("One or more selected products/add-ons were not found."));
        var handler = new SyncOfflineOrdersHandler(db, sender, TestRequest.None());

        var results = await handler.Handle(new SyncOfflineOrdersCommand([Order("OFF-1-aaaa", Line(Guid.NewGuid(), 1, 50m))]), CancellationToken.None);

        results.Single().Error.ShouldBe("One or more selected products/add-ons were not found.");
        (await TestDb.Create(_dbName).UnsyncedOrders.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Retry_WhileTheProductIsStillMissing_StaysOpenAndShowsTheError()
    {
        var id = await FailOne();

        var result = await Retry(id);

        result!.Resolved.ShouldBeFalse();
        result.Error.ShouldNotBeNull();
        result.Order.Status.ShouldBe(UnsyncedOrderStatusEnum.Open);
        (await LoadRow("OFF-1-aaaa")).ResolvedBy.ShouldBeNull();
        await _audit.DidNotReceive().LogAsync(AuditAction.UnsyncedOrderRetried, Arg.Any<AuditEntityType>(), Arg.Any<string>(), Arg.Any<object?>(), Arg.Any<object?>(), Arg.Any<Guid?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Retry_AfterTheFix_SavesTheSaleForTheCashierAndResolvesTheRow()
    {
        var product = Guid.NewGuid();
        await CashierSyncs(Order("OFF-1-aaaa", Line(product, 1, 100m)));
        var id = (await LoadRow("OFF-1-aaaa")).Id;
        await using (var db = TestDb.Create(_dbName))
        {
            db.Products.Add(new Product { Id = product, Name = "Latte", Price = 100m, IsActive = true, Code = "L", CreatedAt = Now, CreatedBy = _adminId });
            await db.SaveChangesAsync();
        }

        var result = await Retry(id);

        result!.Resolved.ShouldBeTrue();
        result.OrderId.ShouldNotBeNull();
        var row = await LoadRow("OFF-1-aaaa");
        row.StatusId.ShouldBe((byte)UnsyncedOrderStatusEnum.Resolved);
        row.Resolution.ShouldBe((byte)UnsyncedOrderResolutionEnum.Retried);
        row.ResolvedBy.ShouldBe(_adminId);
        row.ResultingOrderId.ShouldBe(result.OrderId);
        await using var check = TestDb.Create(_dbName);
        var saved = await check.Orders.SingleAsync(o => o.Id == result.OrderId);
        saved.CreatedBy.ShouldBe(_cashierId);
        saved.OfflineLocalId.ShouldBe("OFF-1-aaaa");
        await _audit.Received(1).LogAsync(AuditAction.UnsyncedOrderRetried, AuditEntityType.UnsyncedOrder, id.ToString(), Arg.Any<object?>(), Arg.Any<object?>(), _adminId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task NoteOnly_SavesACancelledRecordWithTheQuotedTotalAndCash_NotASale()
    {
        var id = await FailOne();

        var detail = await NoteOnly(id);

        detail!.Order.Status.ShouldBe(UnsyncedOrderStatusEnum.Resolved);
        detail.Order.Resolution.ShouldBe(UnsyncedOrderResolutionEnum.NoteOnly);
        detail.Order.ResultingOrderId.ShouldNotBeNull();
        await using var db = TestDb.Create(_dbName);
        var order = await db.Orders.SingleAsync(o => o.Id == detail.Order.ResultingOrderId);
        order.StatusId.ShouldBe((int)OrderStatusEnum.Cancelled);
        order.QuotedTotal.ShouldBe(150m);
        order.AmountReceived.ShouldBe(500m);
        order.PaymentMethodId.ShouldBe((int)PaymentMethodEnum.Cash);
        order.CreatedBy.ShouldBe(_cashierId);
        order.CreatedAt.ShouldBe(Now);
        order.OfflineLocalId.ShouldBe("OFF-1-aaaa");
        order.Note.ShouldStartWith("Unsynced offline sale recorded for the cash drawer");
        order.Note.ShouldContain("2 x unknown product @ 50.00");
        order.Note!.Length.ShouldBeLessThanOrEqualTo(500);
        (await db.StockMovements.CountAsync()).ShouldBe(0);
        await _audit.Received(1).LogAsync(AuditAction.UnsyncedOrderNoteOnly, AuditEntityType.UnsyncedOrder, id.ToString(), Arg.Any<object?>(), Arg.Any<object?>(), _adminId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task NoteOnly_TheDeviceResendingTheOrderAfterwards_FindsItSavedAndDoesNotAddARow()
    {
        var id = await FailOne();
        await NoteOnly(id);

        var again = await CashierSyncs(Order("OFF-1-aaaa", Line(Guid.NewGuid(), 2, 50m)));

        again.Single().Error.ShouldBeNull();
        again.Single().OrderId.ShouldNotBeNull();
        await using var db = TestDb.Create(_dbName);
        (await db.UnsyncedOrders.CountAsync()).ShouldBe(1);
        (await db.Orders.CountAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task Discard_WithAReason_ResolvesTheRowAndKeepsTheReason()
    {
        var id = await FailOne();

        var detail = await Discard(id, "  Test sale, never paid  ");

        detail!.Order.Resolution.ShouldBe(UnsyncedOrderResolutionEnum.Discarded);
        detail.Order.DiscardReason.ShouldBe("Test sale, never paid");
        var row = await LoadRow("OFF-1-aaaa");
        row.StatusId.ShouldBe((byte)UnsyncedOrderStatusEnum.Resolved);
        row.ResolvedBy.ShouldBe(_adminId);
        await using var db = TestDb.Create(_dbName);
        (await db.Orders.CountAsync()).ShouldBe(0);
        await _audit.Received(1).LogAsync(AuditAction.UnsyncedOrderDiscarded, AuditEntityType.UnsyncedOrder, id.ToString(), Arg.Any<object?>(), Arg.Any<object?>(), _adminId, Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Discard_WithoutAReason_IsRefusedAndTheRowStaysOpen(string reason)
    {
        var id = await FailOne();

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Discard(id, reason));

        (await LoadRow("OFF-1-aaaa")).StatusId.ShouldBe((byte)UnsyncedOrderStatusEnum.Open);
    }

    [Fact]
    public async Task Actions_OnAnAlreadyResolvedRow_AreRefused()
    {
        var id = await FailOne();
        await Discard(id, "Duplicate");

        await Should.ThrowAsync<InvalidOperationException>(() => Retry(id));
        await Should.ThrowAsync<InvalidOperationException>(() => NoteOnly(id));
        await Should.ThrowAsync<InvalidOperationException>(() => Discard(id, "Again"));
    }

    [Fact]
    public async Task Actions_OnAnUnknownId_ReturnNothing()
    {
        (await Retry(Guid.NewGuid())).ShouldBeNull();
        (await NoteOnly(Guid.NewGuid())).ShouldBeNull();
        (await Discard(Guid.NewGuid(), "x")).ShouldBeNull();
    }

    [Fact]
    public async Task List_FiltersByStatusAndCashier_AndPages()
    {
        var first = await FailOne("OFF-1-aaaa");
        await FailOne("OFF-2-aaaa");
        await FailOne("OFF-3-aaaa");
        await Discard(first, "Duplicate");
        await using var db = TestDb.Create(_dbName);
        var handler = new GetUnsyncedOrdersHandler(db);

        var open = await handler.Handle(new GetUnsyncedOrdersQuery(Status: UnsyncedOrderStatusEnum.Open), CancellationToken.None);
        var resolved = await handler.Handle(new GetUnsyncedOrdersQuery(Status: UnsyncedOrderStatusEnum.Resolved), CancellationToken.None);
        var otherCashier = await handler.Handle(new GetUnsyncedOrdersQuery(CashierId: Guid.NewGuid()), CancellationToken.None);
        var page = await handler.Handle(new GetUnsyncedOrdersQuery(PageSize: 2, Page: 2, SortBy: "queue", Descending: false), CancellationToken.None);

        open.TotalCount.ShouldBe(2);
        resolved.Items.Single().OfflineLocalId.ShouldBe("OFF-1-aaaa");
        otherCashier.TotalCount.ShouldBe(0);
        page.TotalCount.ShouldBe(3);
        page.Items.Select(i => i.OfflineLocalId).ShouldBe(["OFF-3-aaaa"]);
        open.Items.First().LineCount.ShouldBe(2);
    }

    [Fact]
    public async Task Detail_ShowsTheQuotedLinesAndPayment_AndNamesKnownProducts()
    {
        var latte = await SeedProduct("Latte", 100m);
        await CashierSyncs(Order("OFF-1-aaaa", Line(latte, 1, 100m), Line(Guid.NewGuid(), 2, 25m)));
        var id = (await LoadRow("OFF-1-aaaa")).Id;
        await using var db = TestDb.Create(_dbName);

        var detail = await new GetUnsyncedOrderByIdHandler(db).Handle(new GetUnsyncedOrderByIdQuery(id), CancellationToken.None);

        detail!.Lines.Count.ShouldBe(2);
        detail.Lines[0].ProductName.ShouldBe("Latte");
        detail.Lines[1].ProductName.ShouldBeNull();
        detail.Lines[1].QuotedPrice.ShouldBe(25m);
        detail.PaymentMethod.ShouldBe(PaymentMethodEnum.Cash);
        detail.AmountReceived.ShouldBe(500m);
        detail.Order.CashierName.ShouldBeNull();
        (await new GetUnsyncedOrderByIdHandler(db).Handle(new GetUnsyncedOrderByIdQuery(Guid.NewGuid()), CancellationToken.None)).ShouldBeNull();
    }
}
