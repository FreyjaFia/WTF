using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Products.Enums;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Orders;

public class UpdateOrderHandlerTests
{
    private readonly Guid _userId = Guid.NewGuid();
    private readonly OrderSeed _data;
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly IPushNotificationService _push = TestFakes.Push();
    private readonly IHubContext<DashboardHub> _hub = TestFakes.Hub();

    public UpdateOrderHandlerTests()
    {
        _data = new OrderSeed(TestDb.NewName());
    }

    private UpdateOrderHandler Handler(string? timeZone = null) =>
        new(_data.Open(), TestRequest.As(_userId, AppRoles.Admin, timeZone), _hub, _audit, _push, TestFakes.Conversations());

    private static OrderItemRequestDto Line(Guid productId, int qty = 1, params OrderItemRequestDto[] addOns) =>
        new(productId, qty, [.. addOns], null, null);

    private static UpdateOrderCommand Cmd(Guid id, Guid? customerId, IEnumerable<OrderItemRequestDto> items,
        OrderStatusEnum status = OrderStatusEnum.Pending, string? reason = null, bool isOverride = false,
        List<OrderBundlePromotionRequestDto>? bundles = null) =>
        new()
        {
            Id = id,
            CustomerId = customerId,
            Items = [.. items],
            Status = status,
            OverrideReason = reason,
            IsOverride = isOverride,
            BundlePromotions = bundles ?? [],
        };

    private async Task<List<WTF.Domain.Entities.OrderItem>> LinesOf(Guid orderId)
    {
        await using var db = _data.Open();
        return await db.OrderItems.Where(i => i.OrderId == orderId).ToListAsync();
    }

    // ---- not found / basic update ----

    [Fact]
    public async Task Handle_UnknownOrder_ReturnsNullAndAuditsNothing()
    {
        var p = _data.AddProduct("Burger", 100);

        var result = await Handler().Handle(Cmd(Guid.NewGuid(), null, [Line(p)]), CancellationToken.None);

        result.ShouldBeNull();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
        await _push.DidNotReceiveWithAnyArgs().SendOrderStatusChangedAsync(default!, default, default, default, default);
    }

    [Fact]
    public async Task Handle_PendingOrderStaysPending_ReplacesLinesWithoutPriceSnapshot()
    {
        var burger = _data.AddProduct("Burger", 100);
        var fries = _data.AddProduct("Fries", 50);
        var orderId = _data.AddOrder();
        _data.AddLine(orderId, burger, 1);

        var dto = await Handler().Handle(Cmd(orderId, null, [Line(burger, 3), Line(fries, 2)]), CancellationToken.None);

        dto.ShouldNotBeNull();
        dto!.Status.ShouldBe(OrderStatusEnum.Pending);
        dto.Items.Count.ShouldBe(2);
        dto.TotalAmount.ShouldBe(3 * 100 + 2 * 50);
        var lines = await LinesOf(orderId);
        lines.Count.ShouldBe(2);
        lines.ShouldAllBe(l => l.Price == null && l.OriginalPrice == null);
        lines.Single(l => l.ProductId == burger).Quantity.ShouldBe(3);
        lines.Single(l => l.ProductId == fries).SortOrder.ShouldBe(1);
    }

    [Fact]
    public async Task Handle_RemovingALine_DeletesOldLines()
    {
        var burger = _data.AddProduct("Burger", 100);
        var fries = _data.AddProduct("Fries", 50);
        var orderId = _data.AddOrder();
        _data.AddLine(orderId, burger, 1);
        _data.AddLine(orderId, fries, 1, sortOrder: 1);

        var dto = await Handler().Handle(Cmd(orderId, null, [Line(fries, 4)]), CancellationToken.None);

        dto!.Items.Single().ProductId.ShouldBe(fries);
        dto.TotalAmount.ShouldBe(200);
        (await LinesOf(orderId)).Single().ProductId.ShouldBe(fries);
    }

    [Fact]
    public async Task Handle_PaymentFieldsNoteAndCustomer_ArePersistedAndReturned()
    {
        var burger = _data.AddProduct("Burger", 100);
        var customerId = _data.AddCustomer("Ana", "Cruz");
        var orderId = _data.AddOrder(note: "old");

        var cmd = Cmd(orderId, customerId, [Line(burger, 2)], OrderStatusEnum.Completed) with
        {
            PaymentMethod = PaymentMethodEnum.GCash,
            AmountReceived = 500m,
            ChangeAmount = 300m,
            Tips = 20m,
            SpecialInstructions = "no onions",
            Note = "  thanks  ",
        };

        var dto = await Handler().Handle(cmd, CancellationToken.None);

        dto!.PaymentMethod.ShouldBe(PaymentMethodEnum.GCash);
        dto.AmountReceived.ShouldBe(500m);
        dto.ChangeAmount.ShouldBe(280m);   // 500 - (200 + 20); the 300 the app sent is ignored
        dto.Tips.ShouldBe(20m);
        dto.Note.ShouldBe("thanks");
        dto.UpdatedAt.ShouldNotBeNull();
        await using var db = _data.Open();
        var saved = await db.Orders.SingleAsync();
        saved.CustomerId.ShouldBe(customerId);
        saved.StatusId.ShouldBe((int)OrderStatusEnum.Completed);
        saved.PaymentMethodId.ShouldBe((int)PaymentMethodEnum.GCash);
        saved.SpecialInstructions.ShouldBe("no onions");
        saved.Note.ShouldBe("thanks");
        saved.Tips.ShouldBe(20m);
    }

    [Fact]
    public async Task Handle_WhitespaceNote_IsStoredAsNull()
    {
        var burger = _data.AddProduct("Burger", 100);
        var orderId = _data.AddOrder(note: "old");

        var dto = await Handler().Handle(Cmd(orderId, null, [Line(burger)]) with { Note = "   " }, CancellationToken.None);

        dto!.Note.ShouldBeNull();
    }

    // ---- status transitions ----

    [Theory]
    [InlineData(OrderStatusEnum.Completed)]
    [InlineData(OrderStatusEnum.Cancelled)]
    [InlineData(OrderStatusEnum.Refunded)]
    public async Task Handle_NonPendingOrderWithoutOverride_Throws(OrderStatusEnum current)
    {
        var burger = _data.AddProduct("Burger", 100);
        var orderId = _data.AddOrder(current);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(orderId, null, [Line(burger)]), CancellationToken.None));

        ex.Message.ShouldBe($"Order is already {current} and cannot be updated.");
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Handle_PendingToCompleted_CapturesPriceSnapshotAndPushesAndAudits()
    {
        var burger = _data.AddProduct("Burger", 100);
        var cheese = _data.AddProduct("Cheese", 15, isAddOn: true);
        _data.AllowAddOn(burger, cheese);
        var orderId = _data.AddOrder();

        var dto = await Handler().Handle(
            Cmd(orderId, null, [Line(burger, 2, Line(cheese, 1))], OrderStatusEnum.Completed), CancellationToken.None);

        dto!.TotalAmount.ShouldBe(230m);
        var lines = await LinesOf(orderId);
        var parent = lines.Single(l => l.ParentOrderItemId == null);
        parent.Price.ShouldBe(100m);
        parent.OriginalPrice.ShouldBe(100m);
        lines.Single(l => l.ParentOrderItemId == parent.Id).Price.ShouldBe(15m);
        await _push.Received(1).SendOrderStatusChangedAsync(
            Arg.Is<WTF.Domain.Entities.Order>(o => o.Id == orderId), 230m, OrderStatusEnum.Completed, _userId, Arg.Any<CancellationToken>());
        await _audit.Received(1).LogAsync(
            AuditAction.OrderUpdated, AuditEntityType.Order, orderId.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), Arg.Any<Guid?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_PendingToCancelled_CapturesPriceSnapshotAndPushes()
    {
        var burger = _data.AddProduct("Burger", 100);
        var orderId = _data.AddOrder();

        await Handler().Handle(Cmd(orderId, null, [Line(burger)], OrderStatusEnum.Cancelled), CancellationToken.None);

        (await LinesOf(orderId)).Single().Price.ShouldBe(100m);
        await _push.Received(1).SendOrderStatusChangedAsync(
            Arg.Any<WTF.Domain.Entities.Order>(), 100m, OrderStatusEnum.Cancelled, _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_PendingToPending_DoesNotSendPush()
    {
        var burger = _data.AddProduct("Burger", 100);
        var orderId = _data.AddOrder();

        await Handler().Handle(Cmd(orderId, null, [Line(burger)]), CancellationToken.None);

        await _push.DidNotReceiveWithAnyArgs().SendOrderStatusChangedAsync(default!, default, default, default, default);
    }

    [Fact]
    public async Task Handle_Success_BroadcastsDashboardAndOrderUpdated()
    {
        var burger = _data.AddProduct("Burger", 100);
        var orderId = _data.AddOrder();

        await Handler().Handle(Cmd(orderId, null, [Line(burger)]), CancellationToken.None);

        var group = _hub.Clients.Group(HubNames.Groups.DashboardViewers);
        await group.Received(1).SendCoreAsync(HubNames.Events.DashboardUpdated, Arg.Any<object?[]>(), Arg.Any<CancellationToken>());
        await group.Received(1).SendCoreAsync(
            HubNames.Events.OrderUpdated, Arg.Is<object?[]>(a => a.Length == 1 && (Guid)a[0]! == orderId), Arg.Any<CancellationToken>());
    }

    // ---- price snapshots and promotions ----

    [Fact]
    public async Task Handle_CompletedWithActiveAddOnPriceOverride_UsesOverridePrice()
    {
        var burger = _data.AddProduct("Burger", 100);
        var cheese = _data.AddProduct("Cheese", 15, isAddOn: true);
        _data.AllowAddOn(burger, cheese);
        _data.AddAddOnPriceOverride(burger, cheese, 5m);
        var orderId = _data.AddOrder();

        var dto = await Handler().Handle(
            Cmd(orderId, null, [Line(burger, 1, Line(cheese))], OrderStatusEnum.Completed), CancellationToken.None);

        dto!.TotalAmount.ShouldBe(105m);
        (await LinesOf(orderId)).Single(l => l.ParentOrderItemId != null).Price.ShouldBe(5m);
    }

    [Fact]
    public async Task Handle_CompletedWithDiscountedProductPromo_SnapshotsDiscountAndLabel()
    {
        var burger = _data.AddProduct("Burger", 100);
        var cheese = _data.AddProduct("Cheese", 10, isAddOn: true);
        _data.AllowAddOn(burger, cheese);
        _data.AddDiscountedProductPromo(burger, cheese, percentOff: 20m);
        var orderId = _data.AddOrder();

        var dto = await Handler().Handle(
            Cmd(orderId, null, [Line(burger, 1, Line(cheese))], OrderStatusEnum.Completed), CancellationToken.None);

        var parent = (await LinesOf(orderId)).Single(l => l.ParentOrderItemId == null);
        parent.Price.ShouldBe(80m);
        parent.OriginalPrice.ShouldBe(100m);
        parent.PromoLabel.ShouldNotBeNullOrWhiteSpace();
        dto!.TotalAmount.ShouldBe(90m);
    }

    [Fact]
    public async Task Handle_PendingWithDiscountedProductPromo_DoesNotApplyDiscount()
    {
        var burger = _data.AddProduct("Burger", 100);
        var cheese = _data.AddProduct("Cheese", 10, isAddOn: true);
        _data.AllowAddOn(burger, cheese);
        _data.AddDiscountedProductPromo(burger, cheese, percentOff: 20m);
        var orderId = _data.AddOrder();

        await Handler().Handle(Cmd(orderId, null, [Line(burger, 1, Line(cheese))]), CancellationToken.None);

        var parent = (await LinesOf(orderId)).Single(l => l.ParentOrderItemId == null);
        parent.Price.ShouldBeNull();
        parent.PromoLabel.ShouldBeNull();
    }

    // ---- validation ----

    [Fact]
    public async Task Handle_NestedAddOns_Throws()
    {
        var burger = _data.AddProduct("Burger", 100);
        var cheese = _data.AddProduct("Cheese", 10, isAddOn: true);
        var sauce = _data.AddProduct("Sauce", 5, isAddOn: true);
        var orderId = _data.AddOrder();

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(orderId, null, [Line(burger, 1, Line(cheese, 1, Line(sauce)))]), CancellationToken.None));

        ex.Message.ShouldContain("Nested add-ons are not allowed");
    }

    [Fact]
    public async Task Handle_AddOnNotAllowedForProduct_Throws()
    {
        var burger = _data.AddProduct("Burger", 100);
        var cheese = _data.AddProduct("Cheese", 10, isAddOn: true);
        var orderId = _data.AddOrder();

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(orderId, null, [Line(burger, 1, Line(cheese))]), CancellationToken.None));

        ex.Message.ShouldBe("One or more add-ons are not allowed for this product.");
    }

    [Fact]
    public async Task Handle_SizeRequiredButMissing_Throws()
    {
        var shake = _data.AddProduct("Shake", 100);
        var large = _data.AddProduct("Large", 20, isAddOn: true);
        _data.AllowAddOn(shake, large, AddOnTypeEnum.Size);
        var orderId = _data.AddOrder();

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(orderId, null, [Line(shake)]), CancellationToken.None));

        ex.Message.ShouldBe("A size selection is required and must be exactly one.");
    }

    [Fact]
    public async Task Handle_FlavorRequiredButMissing_Throws()
    {
        var shake = _data.AddProduct("Shake", 100);
        var choc = _data.AddProduct("Choc", 0, isAddOn: true);
        var extra = _data.AddProduct("Extra", 5, isAddOn: true);
        _data.AllowAddOn(shake, choc, AddOnTypeEnum.Flavor);
        _data.AllowAddOn(shake, extra, AddOnTypeEnum.Extra);
        var orderId = _data.AddOrder();

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(orderId, null, [Line(shake, 1, Line(extra))]), CancellationToken.None));

        ex.Message.ShouldBe("A flavor selection is required and must be exactly one.");
    }

    [Fact]
    public async Task Handle_TwoSauces_Throws()
    {
        var wings = _data.AddProduct("Wings", 100);
        var bbq = _data.AddProduct("BBQ", 0, isAddOn: true);
        var hot = _data.AddProduct("Hot", 0, isAddOn: true);
        _data.AllowAddOn(wings, bbq, AddOnTypeEnum.Sauce);
        _data.AllowAddOn(wings, hot, AddOnTypeEnum.Sauce);
        var orderId = _data.AddOrder();

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(orderId, null, [Line(wings, 1, Line(bbq), Line(hot))]), CancellationToken.None));

        ex.Message.ShouldBe("A sauce selection must be at most one.");
    }

    [Fact]
    public async Task Handle_SizeSelected_IsAccepted()
    {
        var shake = _data.AddProduct("Shake", 100);
        var large = _data.AddProduct("Large", 20, isAddOn: true);
        _data.AllowAddOn(shake, large, AddOnTypeEnum.Size);
        var orderId = _data.AddOrder();

        var dto = await Handler().Handle(Cmd(orderId, null, [Line(shake, 1, Line(large))]), CancellationToken.None);

        dto!.TotalAmount.ShouldBe(120m);
        dto.Items.Single().AddOns.Single().ProductName.ShouldBe("Large");
    }

    [Fact]
    public async Task Handle_InactiveProduct_ThrowsAndLeavesOrderUntouched()
    {
        var burger = _data.AddProduct("Burger", 100);
        var old = _data.AddProduct("Retired", 10, isActive: false);
        var orderId = _data.AddOrder();
        _data.AddLine(orderId, burger, 1);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(orderId, null, [Line(old)]), CancellationToken.None));

        ex.Message.ShouldBe("Cannot save order with inactive products/add-ons: Retired.");
        (await LinesOf(orderId)).Single().ProductId.ShouldBe(burger);
    }

    [Fact]
    public async Task Handle_UnknownProduct_Throws()
    {
        var orderId = _data.AddOrder();

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(orderId, null, [Line(Guid.NewGuid())]), CancellationToken.None));

        ex.Message.ShouldBe("One or more selected products/add-ons were not found.");
    }

    // ---- bundle promotions ----

    [Fact]
    public async Task Handle_FixedBundleWithLines_SavesBundleAndCountsItsPrice()
    {
        var burger = _data.AddProduct("Burger", 100);
        var promoId = _data.AddFixedBundle("Combo", 150m);
        var orderId = _data.AddOrder();
        var item = new OrderItemRequestDto(burger, 1, [], null, promoId);

        var dto = await Handler().Handle(
            Cmd(orderId, null, [item], bundles: [new OrderBundlePromotionRequestDto(promoId, 2)]), CancellationToken.None);

        dto!.TotalAmount.ShouldBe(300m);
        dto.BundlePromotions!.Single().UnitPrice.ShouldBe(150m);
        dto.BundlePromotions!.Single().Quantity.ShouldBe(2);
        await using var db = _data.Open();
        (await db.OrderBundlePromotions.CountAsync(b => b.OrderId == orderId)).ShouldBe(1);
    }

    [Fact]
    public async Task Handle_ReplacingBundles_RemovesPreviousBundleRows()
    {
        var burger = _data.AddProduct("Burger", 100);
        var promoId = _data.AddFixedBundle("Combo", 150m);
        var orderId = _data.AddOrder();
        await using (var db = _data.Open())
        {
            db.OrderBundlePromotions.Add(new WTF.Domain.Entities.OrderBundlePromotion
            {
                Id = Guid.NewGuid(),
                OrderId = orderId,
                PromotionId = promoId,
                Quantity = 5,
                UnitPrice = 150m,
            });
            await db.SaveChangesAsync();
        }

        var dto = await Handler().Handle(Cmd(orderId, null, [Line(burger)]), CancellationToken.None);

        dto!.BundlePromotions.ShouldBeEmpty();
        dto.TotalAmount.ShouldBe(100m);
    }

    [Fact]
    public async Task Handle_DuplicateBundlePromotions_Throws()
    {
        var burger = _data.AddProduct("Burger", 100);
        var promoId = _data.AddFixedBundle("Combo", 150m);
        var orderId = _data.AddOrder();

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(orderId, null, [Line(burger)], bundles:
                [new OrderBundlePromotionRequestDto(promoId, 1), new OrderBundlePromotionRequestDto(promoId, 1)]), CancellationToken.None));

        ex.Message.ShouldBe("Duplicate bundle promotions are not allowed.");
    }

    [Fact]
    public async Task Handle_BundleQuantityZero_Throws()
    {
        var burger = _data.AddProduct("Burger", 100);
        var promoId = _data.AddFixedBundle("Combo", 150m);
        var orderId = _data.AddOrder();

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(orderId, null, [Line(burger)], bundles: [new OrderBundlePromotionRequestDto(promoId, 0)]), CancellationToken.None));

        ex.Message.ShouldBe("Bundle promotion quantity must be greater than zero.");
    }

    [Fact]
    public async Task Handle_LineReferencesUnknownBundle_Throws()
    {
        var burger = _data.AddProduct("Burger", 100);
        var orderId = _data.AddOrder();
        var item = new OrderItemRequestDto(burger, 1, [], null, Guid.NewGuid());

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(orderId, null, [item]), CancellationToken.None));

        ex.Message.ShouldBe("Order item references an unknown bundle promotion.");
    }

    [Fact]
    public async Task Handle_BundleThatDoesNotExist_Throws()
    {
        var burger = _data.AddProduct("Burger", 100);
        var orderId = _data.AddOrder();

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(orderId, null, [Line(burger)], bundles: [new OrderBundlePromotionRequestDto(Guid.NewGuid(), 1)]), CancellationToken.None));

        ex.Message.ShouldBe("One or more bundle promotions are invalid.");
    }

    [Fact]
    public async Task Handle_InactiveBundle_Throws()
    {
        var burger = _data.AddProduct("Burger", 100);
        var promoId = _data.AddFixedBundle("Combo", 150m, isActive: false);
        var orderId = _data.AddOrder();

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(orderId, null, [Line(burger)], bundles: [new OrderBundlePromotionRequestDto(promoId, 1)]), CancellationToken.None));

        ex.Message.ShouldContain("Bundle promotion 'Combo' is inactive");
    }

    [Fact]
    public async Task Handle_BundleExpiredDaysAgo_Throws()
    {
        var burger = _data.AddProduct("Burger", 100);
        var promoId = _data.AddFixedBundle("Old combo", 150m, end: DateTime.UtcNow.Date.AddDays(-3));
        var orderId = _data.AddOrder();

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(orderId, null, [Line(burger)], bundles: [new OrderBundlePromotionRequestDto(promoId, 1)]), CancellationToken.None));
    }

    [Fact]
    public async Task Handle_BundleActiveWithUnknownTimeZoneHeader_FallsBackToUtc()
    {
        var burger = _data.AddProduct("Burger", 100);
        var promoId = _data.AddFixedBundle("Combo", 150m,
            start: DateTime.UtcNow.Date.AddDays(-3), end: DateTime.UtcNow.Date.AddDays(3));
        var orderId = _data.AddOrder();

        var dto = await Handler("Not/AZone").Handle(
            Cmd(orderId, null, [Line(burger)], bundles: [new OrderBundlePromotionRequestDto(promoId, 1)]), CancellationToken.None);

        dto!.BundlePromotions.ShouldHaveSingleItem();
    }

    [Fact]
    public async Task Handle_BundleStartingInThreeDays_IsInactiveInAnyTimeZone()
    {
        var burger = _data.AddProduct("Burger", 100);
        var promoId = _data.AddFixedBundle("Future", 150m, start: DateTime.UtcNow.Date.AddDays(3));
        var orderId = _data.AddOrder();

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler("Asia/Manila").Handle(
                Cmd(orderId, null, [Line(burger)], bundles: [new OrderBundlePromotionRequestDto(promoId, 1)]), CancellationToken.None));
    }

    // ---- audit ----

    [Fact]
    public async Task Handle_RegularUpdate_AuditsOrderUpdatedWithOldAndNewValues()
    {
        var burger = _data.AddProduct("Burger", 100);
        var orderId = _data.AddOrder();
        _data.AddLine(orderId, burger, 1);

        await Handler().Handle(Cmd(orderId, null, [Line(burger, 2)]), CancellationToken.None);

        var args = _audit.ReceivedCalls().Single(c => c.GetMethodInfo().Name == nameof(IAuditService.LogAsync)).GetArguments();
        args[0].ShouldBe(AuditAction.OrderUpdated);
        args[1].ShouldBe(AuditEntityType.Order);
        args[2].ShouldBe(orderId.ToString());
        args[3]!.ToString()!.ShouldContain("Pending");
        args[4]!.ToString()!.ShouldContain("totalAmount = 200");
    }

    // ---- override ----

    private Guid CompletedOrderWithBurger(out Guid burger, decimal paidPrice = 90m, decimal listPrice = 100m)
    {
        burger = _data.AddProduct("Burger", listPrice);
        var orderId = _data.AddOrder(OrderStatusEnum.Completed, paymentMethod: PaymentMethodEnum.Cash);
        _data.AddLine(orderId, burger, 1, price: paidPrice, originalPrice: listPrice, promoLabel: "10% off");
        return orderId;
    }

    [Fact]
    public async Task Handle_OverrideOnCompletedOrder_SetsReasonTimestampAndAudit()
    {
        var orderId = CompletedOrderWithBurger(out var burger);
        var cmd = Cmd(orderId, null, [Line(burger, 2)], OrderStatusEnum.Completed, "  wrong quantity  ", isOverride: true);

        var dto = await Handler().Handle(cmd, CancellationToken.None);

        dto!.OverrideReason.ShouldBe("wrong quantity");
        dto.OverriddenAt.ShouldNotBeNull();
        dto.UpdatedBy.ShouldBe(_userId);
        await using var db = _data.Open();
        var saved = await db.Orders.SingleAsync();
        saved.OverrideReason.ShouldBe("wrong quantity");
        saved.OverriddenAt.ShouldNotBeNull();
        saved.UpdatedBy.ShouldBe(_userId);
        saved.StatusId.ShouldBe((int)OrderStatusEnum.Completed);

        await _audit.Received(1).LogAsync(
            AuditAction.OrderOverridden, AuditEntityType.Order, orderId.ToString(),
            Arg.Any<object?>(), Arg.Is<object?>(v => v!.ToString()!.Contains("wrong quantity")), Arg.Any<Guid?>(), Arg.Any<CancellationToken>());
        await _audit.DidNotReceive().LogAsync(
            AuditAction.OrderUpdated, Arg.Any<AuditEntityType>(), Arg.Any<string>(),
            Arg.Any<object?>(), Arg.Any<object?>(), Arg.Any<Guid?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_OverrideKeepsPricesAlreadyPaidForUnchangedLines()
    {
        var orderId = CompletedOrderWithBurger(out var burger, paidPrice: 90m, listPrice: 100m);
        await using (var db = _data.Open())
        {
            var p = await db.Products.SingleAsync();
            p.Price = 120m; // price changed since the sale
            await db.SaveChangesAsync();
        }

        var dto = await Handler().Handle(
            Cmd(orderId, null, [Line(burger, 3)], OrderStatusEnum.Completed, "fix", isOverride: true), CancellationToken.None);

        var line = (await LinesOf(orderId)).Single();
        line.Price.ShouldBe(90m);
        line.OriginalPrice.ShouldBe(100m);
        line.PromoLabel.ShouldBe("10% off");
        dto!.TotalAmount.ShouldBe(270m);
    }

    [Fact]
    public async Task Handle_OverrideAddingNewLine_PricesNewLineAtCurrentPrice()
    {
        var orderId = CompletedOrderWithBurger(out var burger);
        var fries = _data.AddProduct("Fries", 50);

        var dto = await Handler().Handle(
            Cmd(orderId, null, [Line(burger), Line(fries, 2)], OrderStatusEnum.Completed, "added fries", isOverride: true),
            CancellationToken.None);

        dto!.TotalAmount.ShouldBe(90m + 100m);
        (await LinesOf(orderId)).Single(l => l.ProductId == fries).Price.ShouldBe(50m);
    }

    [Fact]
    public async Task Handle_OverrideKeepsPaidAddOnPrice()
    {
        var burger = _data.AddProduct("Burger", 100);
        var cheese = _data.AddProduct("Cheese", 15, isAddOn: true);
        _data.AllowAddOn(burger, cheese);
        var orderId = _data.AddOrder(OrderStatusEnum.Completed);
        var parentId = _data.AddLine(orderId, burger, 1, price: 100m, originalPrice: 100m);
        _data.AddLine(orderId, cheese, 1, price: 8m, parentId: parentId);

        var dto = await Handler().Handle(
            Cmd(orderId, null, [Line(burger, 1, Line(cheese))], OrderStatusEnum.Completed, "fix", isOverride: true),
            CancellationToken.None);

        dto!.TotalAmount.ShouldBe(108m);
        (await LinesOf(orderId)).Single(l => l.ParentOrderItemId != null).Price.ShouldBe(8m);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Handle_OverrideWithoutReason_Throws(string? reason)
    {
        var orderId = CompletedOrderWithBurger(out var burger);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(orderId, null, [Line(burger)], OrderStatusEnum.Completed, reason, isOverride: true), CancellationToken.None));

        ex.Message.ShouldBe("An override reason is required.");
        await using var db = _data.Open();
        (await db.Orders.SingleAsync()).OverrideReason.ShouldBeNull();
    }

    [Theory]
    [InlineData(OrderStatusEnum.Pending)]
    [InlineData(OrderStatusEnum.Cancelled)]
    [InlineData(OrderStatusEnum.Refunded)]
    public async Task Handle_OverrideOnNonCompletedOrder_Throws(OrderStatusEnum current)
    {
        var burger = _data.AddProduct("Burger", 100);
        var orderId = _data.AddOrder(current);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(orderId, null, [Line(burger)], OrderStatusEnum.Completed, "why", isOverride: true), CancellationToken.None));

        ex.Message.ShouldBe("Only completed orders can be overridden.");
    }

    [Theory]
    [InlineData(OrderStatusEnum.Pending)]
    [InlineData(OrderStatusEnum.Cancelled)]
    [InlineData(OrderStatusEnum.Refunded)]
    public async Task Handle_OverrideChangingStatusAwayFromCompleted_Throws(OrderStatusEnum target)
    {
        var orderId = CompletedOrderWithBurger(out var burger);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(orderId, null, [Line(burger)], target, "why", isOverride: true), CancellationToken.None));

        ex.Message.ShouldContain("must stay completed");
    }

    [Fact]
    public async Task Handle_OverrideOnCompletedOrder_SendsStatusPush()
    {
        var orderId = CompletedOrderWithBurger(out var burger);

        await Handler().Handle(Cmd(orderId, null, [Line(burger)], OrderStatusEnum.Completed, "fix", isOverride: true), CancellationToken.None);

        await _push.Received(1).SendOrderStatusChangedAsync(
            Arg.Is<WTF.Domain.Entities.Order>(o => o.Id == orderId), Arg.Any<decimal>(), OrderStatusEnum.Completed, _userId, Arg.Any<CancellationToken>(), true);
        await _hub.Clients.Group(HubNames.Groups.DashboardViewers).Received(1)
            .SendCoreAsync(HubNames.Events.DashboardUpdated, Arg.Any<object?[]>(), Arg.Any<CancellationToken>());
    }

    // Rollback, the OrderNumber unique index and the foreign keys are tested against SQL Server in Database\UpdateOrderDatabaseTests.cs.
}
