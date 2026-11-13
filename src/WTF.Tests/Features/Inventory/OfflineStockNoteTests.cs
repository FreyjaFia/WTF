using MediatR;
using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Services;
using WTF.Calculations.Subscriptions;
using WTF.Domain.Entities;
using WTF.Tests.Features.Orders;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class OfflineStockNoteTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly OrderSeed _data;
    private readonly Guid _beans;
    private readonly Guid _latte;

    public OfflineStockNoteTests()
    {
        _data = new OrderSeed(_db);
        _beans = StockSeed.Item(_db, "Beans", 10m, allowNegative: false);
        _latte = _data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, _latte, _beans, 4m);
    }

    private static ITenantFeatures Plan(string features)
    {
        var plan = Substitute.For<ITenantFeatures>();
        plan.GetAsync(Arg.Any<WTF.Domain.Data.WTFDbContext>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(new TenantPlan("Test", PlanFeatures.Parse(features)));
        return plan;
    }

    private SyncOfflineOrdersHandler Sync(ITenantFeatures? features = null)
    {
        var db = TestDb.Create(_db);
        var accessor = TestRequest.As(_userId, AppRoles.Admin);
        var create = new CreateOrderHandler(db, accessor, TestFakes.Hub(), _audit, TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(db, features));
        var sender = Substitute.For<ISender>();
        sender.Send(Arg.Any<CreateOrderCommand>(), Arg.Any<CancellationToken>())
            .Returns(call => create.Handle(call.Arg<CreateOrderCommand>(), call.Arg<CancellationToken>()));
        return new SyncOfflineOrdersHandler(db, sender, accessor);
    }

    private static CreateOrderCommand Offline(string localId, Guid productId, int qty, decimal quoted) => new()
    {
        Status = OrderStatusEnum.Completed,
        Items = [new OrderItemRequestDto(productId, qty, [], null, null, quoted)],
        OfflineLocalId = localId,
        CreatedAt = DateTime.UtcNow,
        PaymentMethod = PaymentMethodEnum.Cash,
        AmountReceived = 1000m
    };

    private async Task<OfflineSyncResultDto> SyncOne(CreateOrderCommand order, ITenantFeatures? features = null) =>
        (await Sync(features).Handle(new SyncOfflineOrdersCommand([order]), CancellationToken.None)).Single();

    private ISender GetSender()
    {
        var sender = Substitute.For<ISender>();
        sender.Send(Arg.Any<IRequest<OrderDto?>>(), Arg.Any<CancellationToken>())
            .Returns(call => new GetOrderByIdHandler(TestDb.Create(_db))
                .Handle((GetOrderByIdQuery)call.Arg<IRequest<OrderDto?>>(), call.Arg<CancellationToken>()));
        return sender;
    }

    private async Task<Guid> HeldOrderAsync()
    {
        // A quoted price that differs from today's makes the sale a hold.
        var result = await SyncOne(Offline("OFF-7D-held", _latte, 2, 100m));
        result.Status.ShouldBe(OrderStatusEnum.PendingReview);
        return result.OrderId!.Value;
    }

    private RejectHeldOrderHandler Reject() =>
        new(TestDb.Create(_db), TestRequest.As(_userId, AppRoles.Admin), TestFakes.Hub(), _audit, TestFakes.Conversations(), GetSender(),
            StockWithSharedAudit());

    private IOrderStockService StockWithSharedAudit()
    {
        var db = TestDb.Create(_db);
        return new OrderStockService(db, _audit, TestFakes.Alerts(db));
    }

    private async Task<List<OrderReviewReason>> ReasonRowsAsync(Guid orderId)
    {
        await using var db = TestDb.Create(_db);
        return await db.OrderReviewReasons.Where(r => r.OrderId == orderId).OrderBy(r => r.SortOrder).ToListAsync();
    }

    [Fact]
    public async Task Sync_StockShortfall_IsASavedNoteNeverAHold()
    {
        var result = await SyncOne(Offline("OFF-7D-1", _latte, 3, 150m));

        result.Status.ShouldBe(OrderStatusEnum.Completed);
        StockSeed.Balance(_db, _beans).ShouldBe(-2m);
        var note = result.ReasonDetails!.Single(r => r.Code == OfflineReasonCodes.StockShortfall);
        note.Severity.ShouldBe("Note");
        note.ExpectedValue.ShouldBe("10");
        note.QuotedValue.ShouldBe("12");
        note.Text.ShouldContain("Beans");
        result.StockWarnings!.ShouldNotBeEmpty();

        var row = (await ReasonRowsAsync(result.OrderId!.Value)).Single();
        row.Code.ShouldBe(OfflineReasonCodes.StockShortfall);
        row.Severity.ShouldBe((byte)ReviewSeverityEnum.Note);
        row.ExpectedValue.ShouldBe("10");
        row.QuotedValue.ShouldBe("12");
    }

    [Fact]
    public async Task Sync_EnoughStock_HasNoShortfallNote()
    {
        var result = await SyncOne(Offline("OFF-7D-2", _latte, 2, 150m));

        result.ReasonDetails!.ShouldBeEmpty();
        (await ReasonRowsAsync(result.OrderId!.Value)).ShouldBeEmpty();
    }

    [Fact]
    public async Task Sync_PlanWithoutInventory_GetsNoShortfallNoteAndTheSaleStillSaves()
    {
        var result = await SyncOne(Offline("OFF-7D-3", _latte, 3, 150m), Plan("promotions"));

        result.Error.ShouldBeNull();
        result.Status.ShouldBe(OrderStatusEnum.Completed);
        result.ReasonDetails!.ShouldBeEmpty();
        (await ReasonRowsAsync(result.OrderId!.Value)).ShouldBeEmpty();
    }

    [Fact]
    public async Task Sync_PlanWithInventory_GetsTheNote()
    {
        var result = await SyncOne(Offline("OFF-7D-4", _latte, 3, 150m), Plan("inventory"));

        result.ReasonDetails!.Single().Code.ShouldBe(OfflineReasonCodes.StockShortfall);
    }

    [Fact]
    public async Task HeldOrder_TakesNoStockUntilApproved_ThenNotesTheShortfall()
    {
        var id = await HeldOrderAsync();
        StockSeed.Balance(_db, _beans).ShouldBe(10m);
        StockSeed.Movements(_db, _beans).ShouldBeEmpty();

        var approve = new ApproveHeldOrderHandler(
            TestDb.Create(_db), TestRequest.As(_userId, AppRoles.Admin), TestFakes.Hub(), _audit, TestFakes.Conversations(), GetSender(),
            TestFakes.Stock(TestDb.Create(_db)));
        await approve.Handle(new ApproveHeldOrderCommand(id), CancellationToken.None);

        StockSeed.Balance(_db, _beans).ShouldBe(2m);
        StockSeed.Movements(_db, _beans).Single().MovementType.ShouldBe(StockMovementTypes.Sale);
    }

    [Fact]
    public async Task Reject_WithWaste_WritesWasteMovementsAndAudits()
    {
        var id = await HeldOrderAsync();

        var dto = await Reject().Handle(new RejectHeldOrderCommand(id, "Wrong price", "waste"), CancellationToken.None);

        dto!.Status.ShouldBe(OrderStatusEnum.Cancelled);
        var movement = StockSeed.Movements(_db, _beans).Single();
        movement.MovementType.ShouldBe(StockMovementTypes.Waste);
        movement.QuantityDelta.ShouldBe(-8m);
        movement.ReferenceId.ShouldBe(id);
        StockSeed.Balance(_db, _beans).ShouldBe(2m);
        await _audit.Received(1).LogAsync(AuditAction.OrderStockWasted, AuditEntityType.Order, id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), Arg.Any<Guid?>(), Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("none")]
    public async Task Reject_WithoutTheOptionOrNone_LeavesStockAlone(string? outcome)
    {
        var id = await HeldOrderAsync();

        var dto = await Reject().Handle(new RejectHeldOrderCommand(id, "Wrong price", outcome), CancellationToken.None);

        dto!.Status.ShouldBe(OrderStatusEnum.Cancelled);
        StockSeed.Movements(_db, _beans).ShouldBeEmpty();
        StockSeed.Balance(_db, _beans).ShouldBe(10m);
        await _audit.DidNotReceive().LogAsync(AuditAction.OrderStockWasted, Arg.Any<AuditEntityType>(), Arg.Any<string?>(),
            Arg.Any<object?>(), Arg.Any<object?>(), Arg.Any<Guid?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Reject_WithAnUnknownOutcome_Throws()
    {
        var id = await HeldOrderAsync();

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Reject().Handle(new RejectHeldOrderCommand(id, "Wrong price", "burn"), CancellationToken.None));
    }

    [Fact]
    public async Task NeedsAttention_ListsAnItemLeftNegativeByAnOfflineSale()
    {
        await SyncOne(Offline("OFF-7D-5", _latte, 3, 150m));

        var result = await new GetStockAttentionHandler(TestDb.Create(_db)).Handle(new GetStockAttentionQuery(), CancellationToken.None);

        var item = result.Items.Single(i => i.Name == "Beans");
        item.Status.ShouldBe("OutOfStock");
        item.CurrentQuantity.ShouldBe(-2m);
    }
}
