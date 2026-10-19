using MediatR;
using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Features.Promotions;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Orders;

public class OfflineSyncTests
{
    private static readonly DateTime Now = new(2026, 6, 10, 12, 0, 0, DateTimeKind.Utc);

    private readonly Guid _userId = Guid.NewGuid();
    private readonly string _dbName = TestDb.NewName();
    private readonly IAuditService _audit = TestFakes.Audit();

    private SyncOfflineOrdersHandler SyncHandler()
    {
        var db = TestDb.Create(_dbName);
        var accessor = TestRequest.As(_userId, AppRoles.Admin);
        var create = new CreateOrderHandler(db, accessor, TestFakes.Hub(), _audit, TestFakes.Push(), TestFakes.Conversations());
        var sender = Substitute.For<ISender>();
        sender.Send(Arg.Any<CreateOrderCommand>(), Arg.Any<CancellationToken>())
            .Returns(call => create.Handle(call.Arg<CreateOrderCommand>(), call.Arg<CancellationToken>()));
        return new SyncOfflineOrdersHandler(db, sender, accessor);
    }

    private static OrderItemRequestDto Line(Guid productId, int qty, decimal? quoted, Guid? bundle = null, params OrderItemRequestDto[] addOns) =>
        new(productId, qty, [.. addOns], null, bundle, quoted);

    private static OrderItemRequestDto AddOn(Guid productId, decimal? quoted, int qty = 1) =>
        new(productId, qty, [], null, null, quoted);

    private static CreateOrderCommand Order(string? localId, OrderStatusEnum status, params OrderItemRequestDto[] items) =>
        new()
        {
            Status = status,
            Items = [.. items],
            OfflineLocalId = localId,
            CreatedAt = Now,
            PaymentMethod = PaymentMethodEnum.Cash,
            AmountReceived = 1000m,
        };

    private async Task<Guid> SeedProduct(string name, decimal price, bool active = true, bool isAddOn = false)
    {
        await using var db = TestDb.Create(_dbName);
        var product = new Product { Id = Guid.NewGuid(), Name = name, Price = price, IsActive = active, IsAddOn = isAddOn, Code = name, CreatedAt = Now, CreatedBy = _userId };
        db.Products.Add(product);
        await db.SaveChangesAsync();
        return product.Id;
    }

    private async Task<Order> LoadOrder(Guid id)
    {
        await using var db = TestDb.Create(_dbName);
        return await db.Orders.AsNoTracking().Include(o => o.OrderItems).Include(o => o.OrderBundlePromotions).SingleAsync(o => o.Id == id);
    }

    private async Task<OfflineSyncResultDto> SyncOne(CreateOrderCommand order)
    {
        var results = await SyncHandler().Handle(new SyncOfflineOrdersCommand([order]), CancellationToken.None);
        return results.Single();
    }

    // ---- limited promotions and the offline sync ----

    private async Task<Guid> SeedLimitedDiscount(Guid productId, int maxRedemptions, decimal percent = 50m, int? maxPerOrder = null)
    {
        await using var db = TestDb.Create(_dbName);
        var promo = new Promotion
        {
            Id = Guid.NewGuid(),
            Name = "Limited",
            TypeId = PromotionTypeIds.DiscountedProduct,
            IsActive = true,
            MaxRedemptions = maxRedemptions,
            MaxPerOrder = maxPerOrder,
            CreatedAt = Now,
            CreatedBy = _userId
        };
        promo.DiscountedProductPromotions.Add(new DiscountedProductPromotion
        {
            Id = Guid.NewGuid(),
            PromotionId = promo.Id,
            ProductId = productId,
            PercentOff = percent
        });
        db.Promotions.Add(promo);
        await db.SaveChangesAsync();
        return promo.Id;
    }

    private async Task<int> DiscountUses(Guid promotionId)
    {
        await using var db = TestDb.Create(_dbName);
        var counted = new[] { (int)OrderStatusEnum.Pending, (int)OrderStatusEnum.Completed, (int)OrderStatusEnum.PendingApproval, (int)OrderStatusEnum.PendingReview };
        return await db.OrderItems
            .Where(i => i.DiscountPromotionId == promotionId && counted.Contains(i.Order.StatusId))
            .SumAsync(i => i.Quantity);
    }

    [Fact]
    public async Task Sync_ADiscountedSaleWhileAUseIsFree_IsSavedAndUsesIt()
    {
        var croissant = await SeedProduct("Croissant", 100m);
        var promo = await SeedLimitedDiscount(croissant, 1);

        var result = await SyncOne(Order("OFF-10-aaaa", OrderStatusEnum.Completed, Line(croissant, 1, 50m)));

        result.Status.ShouldBe(OrderStatusEnum.Completed);
        result.Reasons.ShouldBeEmpty();
        var saved = await LoadOrder(result.OrderId!.Value);
        saved.OrderItems.Single().Price.ShouldBe(50m);
        saved.OrderItems.Single().DiscountPromotionId.ShouldBe(promo);
        (await DiscountUses(promo)).ShouldBe(1);
    }

    [Fact]
    public async Task Sync_ASaleSplitByALimitPerOrder_IsSavedAsQuotedAndUsesOnlyTheDiscountedItems()
    {
        var croissant = await SeedProduct("Croissant", 100m);
        var promo = await SeedLimitedDiscount(croissant, 10, maxPerOrder: 2);

        var result = await SyncOne(Order("OFF-20-aaaa", OrderStatusEnum.Completed, Line(croissant, 2, 50m), Line(croissant, 1, 100m)));

        result.Status.ShouldBe(OrderStatusEnum.Completed);
        result.Reasons.ShouldBeEmpty();
        (await DiscountUses(promo)).ShouldBe(2);
    }

    [Fact]
    public async Task Sync_ALineQuotedAtOnePriceButNowCoveredInPart_IsHeld()
    {
        var croissant = await SeedProduct("Croissant", 100m);
        var promo = await SeedLimitedDiscount(croissant, 10, maxPerOrder: 2);

        var result = await SyncOne(Order("OFF-21-aaaa", OrderStatusEnum.Completed, Line(croissant, 3, 50m)));

        result.Status.ShouldBe(OrderStatusEnum.PendingReview);
        result.Reasons.ShouldBe(["Croissant: the promotion now covers only 2 of 3."]);
        (await DiscountUses(promo)).ShouldBe(0);
    }

    [Fact]
    public async Task Sync_ADiscountedSaleAfterThePromotionRanOut_IsHeldAtTheQuotedPriceAndTakesNoUse()
    {
        var croissant = await SeedProduct("Croissant", 100m);
        var promo = await SeedLimitedDiscount(croissant, 1);
        await SyncOne(Order("OFF-11-aaaa", OrderStatusEnum.Completed, Line(croissant, 1, 50m)));

        var late = await SyncOne(Order("OFF-12-aaaa", OrderStatusEnum.Completed, Line(croissant, 1, 50m)));

        late.Status.ShouldBe(OrderStatusEnum.PendingReview);
        late.Reasons.ShouldBe(["Croissant now costs 100.00, quoted 50.00."]);
        var saved = await LoadOrder(late.OrderId!.Value);
        saved.OrderItems.Single().Price.ShouldBe(50m, "the customer paid the quoted price");
        (await DiscountUses(promo)).ShouldBe(1, "a held order does not take a use the promotion no longer has");
    }

    [Fact]
    public async Task Sync_TwoOrdersInOneRequest_ShareTheLastUse()
    {
        var croissant = await SeedProduct("Croissant", 100m);
        var promo = await SeedLimitedDiscount(croissant, 1);

        var results = await SyncHandler().Handle(
            new SyncOfflineOrdersCommand(
            [
                Order("OFF-13-aaaa", OrderStatusEnum.Completed, Line(croissant, 1, 50m)),
                Order("OFF-14-aaaa", OrderStatusEnum.Completed, Line(croissant, 1, 50m)),
            ]),
            CancellationToken.None);

        results[0].Status.ShouldBe(OrderStatusEnum.Completed);
        results[1].Status.ShouldBe(OrderStatusEnum.PendingReview);
        (await DiscountUses(promo)).ShouldBe(1);
    }

    [Fact]
    public async Task Sync_ASaleQuotedAtFullPriceWhileThePromotionIsOn_IsHeldSoTheCustomerCanBeRefunded()
    {
        var croissant = await SeedProduct("Croissant", 100m);
        await SeedLimitedDiscount(croissant, 5);

        var result = await SyncOne(Order("OFF-15-aaaa", OrderStatusEnum.Completed, Line(croissant, 1, 100m)));

        result.Status.ShouldBe(OrderStatusEnum.PendingReview);
        result.Reasons.ShouldBe(["Croissant now costs 50.00, quoted 100.00."]);
    }

    [Fact]
    public async Task Sync_AnOpenOfflineOrder_HoldsAUseLikeAnyOtherOpenOrder()
    {
        var croissant = await SeedProduct("Croissant", 100m);
        var promo = await SeedLimitedDiscount(croissant, 1);

        var open = await SyncOne(Order("OFF-16-aaaa", OrderStatusEnum.Pending, Line(croissant, 1, null)));

        open.Status.ShouldBe(OrderStatusEnum.Pending);
        var saved = await LoadOrder(open.OrderId!.Value);
        saved.OrderItems.Single().Price.ShouldBeNull();
        saved.OrderItems.Single().DiscountPromotionId.ShouldBe(promo);

        var after = await SyncOne(Order("OFF-17-aaaa", OrderStatusEnum.Completed, Line(croissant, 1, 50m)));
        after.Status.ShouldBe(OrderStatusEnum.PendingReview);
    }

    [Fact]
    public async Task Sync_AnOrderSentTwice_IsNotCountedTwice()
    {
        var croissant = await SeedProduct("Croissant", 100m);
        var promo = await SeedLimitedDiscount(croissant, 3);
        var order = Order("OFF-18-aaaa", OrderStatusEnum.Completed, Line(croissant, 2, 50m));

        var first = await SyncOne(order);
        var again = await SyncOne(order);

        again.OrderId.ShouldBe(first.OrderId);
        (await DiscountUses(promo)).ShouldBe(2);
    }

    [Fact]
    public async Task Sync_RacingALiveSaleForTheLastUse_GivesTheUseToExactlyOne()
    {
        var croissant = await SeedProduct("Croissant", 100m);
        var promo = await SeedLimitedDiscount(croissant, 1);

        var offline = SyncOne(Order("OFF-19-aaaa", OrderStatusEnum.Completed, Line(croissant, 1, 50m)));
        var live = new CreateOrderHandler(
                TestDb.Create(_dbName), TestRequest.As(_userId, AppRoles.Admin), TestFakes.Hub(), _audit, TestFakes.Push(), TestFakes.Conversations())
            .Handle(new CreateOrderCommand { Status = OrderStatusEnum.Completed, Items = [Line(croissant, 1, null)] }, CancellationToken.None);
        await Task.WhenAll(offline, live);

        (await DiscountUses(promo)).ShouldBe(1, "never over the limit, whichever sale got there first");
        var winnerWasLive = (await live).TotalAmount == 50m;
        (await offline).Status.ShouldBe(winnerWasLive ? OrderStatusEnum.PendingReview : OrderStatusEnum.Completed);
    }

    [Fact]
    public async Task Create_ASaleHeldForReviewWithoutQuotes_IsStillRefused()
    {
        // The review path only runs inside the sync; nobody can create a held order directly.
        var croissant = await SeedProduct("Croissant", 100m);
        var command = new CreateOrderCommand { Status = OrderStatusEnum.PendingReview, Items = [Line(croissant, 1, 50m)] };
        var handler = new CreateOrderHandler(
            TestDb.Create(_dbName), TestRequest.As(_userId, AppRoles.Admin), TestFakes.Hub(), _audit, TestFakes.Push(), TestFakes.Conversations());

        await Should.ThrowAsync<InvalidOperationException>(() => handler.Handle(command, CancellationToken.None));
    }

    [Fact]
    public async Task Sync_NothingChanged_SavesAnOrdinaryCompletedOrder()
    {
        var latte = await SeedProduct("Latte", 150m);

        var result = await SyncOne(Order("OFF-1-aaaa", OrderStatusEnum.Completed, Line(latte, 2, 150m)));

        result.Error.ShouldBeNull();
        result.Status.ShouldBe(OrderStatusEnum.Completed);
        result.Reasons.ShouldBeEmpty();
        var saved = await LoadOrder(result.OrderId!.Value);
        saved.OfflineLocalId.ShouldBe("OFF-1-aaaa");
        saved.ReviewReasons.ShouldBeNull();
    }

    [Fact]
    public async Task Sync_PriceChangedSinceTheSale_HoldsTheOrderAtTheQuotedPrice()
    {
        var latte = await SeedProduct("Latte", 160m);

        var result = await SyncOne(Order("OFF-2-aaaa", OrderStatusEnum.Completed, Line(latte, 2, 150m)));

        result.Status.ShouldBe(OrderStatusEnum.PendingReview);
        result.Reasons.ShouldBe(["Latte now costs 160.00, quoted 150.00."]);
        var saved = await LoadOrder(result.OrderId!.Value);
        saved.StatusId.ShouldBe((int)OrderStatusEnum.PendingReview);
        saved.QuotedTotal.ShouldBe(300m);
        saved.ReviewReasons.ShouldBe("Latte now costs 160.00, quoted 150.00.");
        saved.OrderItems.Single().Price.ShouldBe(150m);
        saved.OrderItems.Single().OriginalPrice.ShouldBe(150m);
    }

    [Fact]
    public async Task Sync_ProductDeactivatedSinceTheSale_HoldsTheOrder()
    {
        var latte = await SeedProduct("Latte", 150m, active: false);

        var result = await SyncOne(Order("OFF-3-aaaa", OrderStatusEnum.Completed, Line(latte, 1, 150m)));

        result.Status.ShouldBe(OrderStatusEnum.PendingReview);
        result.Reasons.ShouldBe(["Latte is inactive."]);
    }

    [Fact]
    public async Task Sync_AddOnPriceChanged_HoldsTheOrderAndKeepsTheQuotedAddOnPrice()
    {
        var latte = await SeedProduct("Latte", 150m);
        var oat = await SeedProduct("Oat Milk", 30m, isAddOn: true);

        var result = await SyncOne(Order("OFF-4-aaaa", OrderStatusEnum.Completed, Line(latte, 1, 150m, null, AddOn(oat, 20m))));

        result.Status.ShouldBe(OrderStatusEnum.PendingReview);
        result.Reasons.ShouldBe(["Oat Milk on Latte now costs 30.00, quoted 20.00."]);
        var saved = await LoadOrder(result.OrderId!.Value);
        saved.QuotedTotal.ShouldBe(170m);
        saved.OrderItems.Single(i => i.ParentOrderItemId != null).Price.ShouldBe(20m);
    }

    [Fact]
    public async Task Sync_BundleThatEndedSinceTheSale_HoldsTheOrderAtTheQuotedBundlePrice()
    {
        var latte = await SeedProduct("Latte", 150m);
        Guid bundle;
        await using (var db = TestDb.Create(_dbName))
        {
            var promo = PromotionSeed.NewPromotion(PromotionTypeIds.FixedBundle, "Combo", isActive: false);
            promo.CreatedBy = _userId;
            promo.FixedBundlePromotion = new FixedBundlePromotion { BundlePrice = 250m };
            promo.FixedBundlePromotion.FixedBundlePromotionItems.Add(new FixedBundlePromotionItem { Id = Guid.NewGuid(), ProductId = latte, Quantity = 1 });
            db.Promotions.Add(promo);
            await db.SaveChangesAsync();
            bundle = promo.Id;
        }

        var order = Order("OFF-5-aaaa", OrderStatusEnum.Completed, Line(latte, 1, 150m, bundle)) with
        {
            BundlePromotions = [new OrderBundlePromotionRequestDto(bundle, 1, 240m)]
        };
        var result = await SyncOne(order);

        result.Status.ShouldBe(OrderStatusEnum.PendingReview);
        result.Reasons.ShouldContain("Bundle promotion 'Combo' is inactive or outside its active date range.");
        var saved = await LoadOrder(result.OrderId!.Value);
        saved.OrderBundlePromotions.Single().UnitPrice.ShouldBe(240m);
        saved.QuotedTotal.ShouldBe(240m);
    }

    [Fact]
    public async Task Sync_TheSameQueueNumberTwice_ReturnsTheSavedOrderWithoutADuplicate()
    {
        var latte = await SeedProduct("Latte", 160m);
        var order = Order("OFF-6-aaaa", OrderStatusEnum.Completed, Line(latte, 1, 150m));

        var first = await SyncOne(order);
        var second = await SyncOne(order);

        second.OrderId.ShouldBe(first.OrderId);
        second.Status.ShouldBe(OrderStatusEnum.PendingReview);
        second.Reasons.ShouldBe(first.Reasons);
        await using var db = TestDb.Create(_dbName);
        (await db.Orders.CountAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task Sync_ABadOrder_DoesNotStopTheOthers()
    {
        var latte = await SeedProduct("Latte", 150m);

        var results = await SyncHandler().Handle(
            new SyncOfflineOrdersCommand(
            [
                Order("OFF-7-aaaa", OrderStatusEnum.Completed, Line(latte, 0, 150m)),
                Order("OFF-8-aaaa", OrderStatusEnum.Completed, Line(latte, 1, 150m)),
            ]),
            CancellationToken.None);

        results[0].Error.ShouldBe("Item quantity must be greater than zero.");
        results[0].OrderId.ShouldBeNull();
        results[1].Error.ShouldBeNull();
        results[1].Status.ShouldBe(OrderStatusEnum.Completed);
        await using var db = TestDb.Create(_dbName);
        (await db.Orders.CountAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task Sync_WithoutAQueueNumber_FailsThatOrder()
    {
        var latte = await SeedProduct("Latte", 150m);

        var result = await SyncOne(Order(null, OrderStatusEnum.Completed, Line(latte, 1, 150m)));

        result.Error.ShouldNotBeNull();
        result.OrderId.ShouldBeNull();
    }

    [Fact]
    public async Task Sync_AnOpenOrderWithAChangedPrice_IsNotHeld()
    {
        var latte = await SeedProduct("Latte", 160m);

        var result = await SyncOne(Order("OFF-9-aaaa", OrderStatusEnum.Pending, Line(latte, 1, 150m)));

        result.Status.ShouldBe(OrderStatusEnum.Pending);
        result.Reasons.ShouldBeEmpty();
    }

    [Fact]
    public async Task Sync_AnOrderWithoutQuotedPrices_IsPricedAsUsual()
    {
        var latte = await SeedProduct("Latte", 160m);

        var result = await SyncOne(Order("OFF-10-aaaa", OrderStatusEnum.Completed, Line(latte, 1, null)));

        result.Status.ShouldBe(OrderStatusEnum.Completed);
        (await LoadOrder(result.OrderId!.Value)).OrderItems.Single().Price.ShouldBe(160m);
    }

    [Fact]
    public async Task Sync_AHeldOrderIsAuditedWithItsReasons()
    {
        var latte = await SeedProduct("Latte", 160m);

        await SyncOne(Order("OFF-11-aaaa", OrderStatusEnum.Completed, Line(latte, 1, 150m)));

        await _audit.Received(1).LogAsync(
            AuditAction.OrderHeldForReview,
            AuditEntityType.Order,
            Arg.Any<string>(),
            Arg.Any<object?>(),
            Arg.Any<object?>(),
            Arg.Any<Guid?>(),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Create_AsWaitingForReview_IsRefused()
    {
        var latte = await SeedProduct("Latte", 150m);
        var handler = new CreateOrderHandler(TestDb.Create(_dbName), TestRequest.As(_userId, AppRoles.Admin), TestFakes.Hub(), _audit, TestFakes.Push(), TestFakes.Conversations());

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            handler.Handle(Order(null, OrderStatusEnum.PendingReview, Line(latte, 1, null)), CancellationToken.None));

        ex.Message.ShouldBe("An order cannot be created as waiting for review.");
    }

    private async Task<Guid> SeedHeldOrder()
    {
        var latte = await SeedProduct("Latte", 160m);
        var result = await SyncOne(Order("OFF-20-aaaa", OrderStatusEnum.Completed, Line(latte, 1, 150m)));
        return result.OrderId!.Value;
    }

    private ISender GetSender()
    {
        var sender = Substitute.For<ISender>();
        sender.Send(Arg.Any<IRequest<OrderDto?>>(), Arg.Any<CancellationToken>())
            .Returns(call => new GetOrderByIdHandler(TestDb.Create(_dbName))
                .Handle((GetOrderByIdQuery)call.Arg<IRequest<OrderDto?>>(), call.Arg<CancellationToken>()));
        return sender;
    }

    [Fact]
    public async Task Approve_AHeldOrder_CompletesItAtTheQuotedPrice()
    {
        var id = await SeedHeldOrder();
        var handler = new ApproveHeldOrderHandler(
            TestDb.Create(_dbName), TestRequest.As(_userId, AppRoles.Admin), TestFakes.Hub(), _audit, TestFakes.Conversations(), GetSender());

        var dto = await handler.Handle(new ApproveHeldOrderCommand(id), CancellationToken.None);

        dto!.Status.ShouldBe(OrderStatusEnum.Completed);
        dto.TotalAmount.ShouldBe(150m);
        (await LoadOrder(id)).ReviewReasons.ShouldNotBeNull();
    }

    [Fact]
    public async Task Approve_AnOrderThatIsNotHeld_Throws()
    {
        var latte = await SeedProduct("Latte", 150m);
        var result = await SyncOne(Order("OFF-21-aaaa", OrderStatusEnum.Completed, Line(latte, 1, 150m)));
        var handler = new ApproveHeldOrderHandler(
            TestDb.Create(_dbName), TestRequest.As(_userId, AppRoles.Admin), TestFakes.Hub(), _audit, TestFakes.Conversations(), GetSender());

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            handler.Handle(new ApproveHeldOrderCommand(result.OrderId!.Value), CancellationToken.None));

        ex.Message.ShouldBe("Only orders waiting for review can be approved.");
    }

    [Fact]
    public async Task Reject_AHeldOrder_CancelsItWithTheReason()
    {
        var id = await SeedHeldOrder();
        var handler = new RejectHeldOrderHandler(
            TestDb.Create(_dbName), TestRequest.As(_userId, AppRoles.Admin), TestFakes.Hub(), _audit, TestFakes.Conversations(), GetSender());

        var dto = await handler.Handle(new RejectHeldOrderCommand(id, "  Wrong price  "), CancellationToken.None);

        dto!.Status.ShouldBe(OrderStatusEnum.Cancelled);
        var saved = await LoadOrder(id);
        saved.RejectionReason.ShouldBe("Wrong price");
        saved.Note.ShouldBe("Wrong price");
    }

    [Fact]
    public async Task Reject_WithoutAReason_Throws()
    {
        var id = await SeedHeldOrder();
        var handler = new RejectHeldOrderHandler(
            TestDb.Create(_dbName), TestRequest.As(_userId, AppRoles.Admin), TestFakes.Hub(), _audit, TestFakes.Conversations(), GetSender());

        await Should.ThrowAsync<InvalidOperationException>(() =>
            handler.Handle(new RejectHeldOrderCommand(id, "  "), CancellationToken.None));
        (await LoadOrder(id)).StatusId.ShouldBe((int)OrderStatusEnum.PendingReview);
    }

    [Fact]
    public async Task Void_AHeldOrder_Throws()
    {
        var id = await SeedHeldOrder();
        var handler = new VoidOrderHandler(
            TestDb.Create(_dbName), TestRequest.As(_userId, AppRoles.Admin), TestFakes.Hub(), _audit, TestFakes.Push(), TestFakes.Conversations());

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            handler.Handle(new VoidOrderCommand(id), CancellationToken.None));

        ex.Message.ShouldContain("review");
    }
}
