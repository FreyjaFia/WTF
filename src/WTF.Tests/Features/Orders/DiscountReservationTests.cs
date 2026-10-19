using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Features.OrderLinks;
using WTF.Api.Features.OrderLinks.DTOs;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Orders;

// A limited discount is held from the moment an order is saved, like a bundle: a pending or waiting order keeps its uses,
// and a cancelled, rejected or voided order gives them back.
public class DiscountReservationTests
{
    private readonly Guid _userId = Guid.NewGuid();
    private readonly OrderSeed _data = new(TestDb.NewName());
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly IPushNotificationService _push = TestFakes.Push();
    private readonly IHubContext<DashboardHub> _hub = TestFakes.Hub();

    private CreateOrderHandler Create() =>
        new(_data.Open(), TestRequest.As(_userId, AppRoles.Admin, "UTC"), _hub, _audit, _push, TestFakes.Conversations(), TestFakes.Stock(_data.Open()));

    private UpdateOrderHandler Update() =>
        new(_data.Open(), TestRequest.As(_userId, AppRoles.Admin, "UTC"), _hub, _audit, _push, TestFakes.Conversations(), TestFakes.Stock(_data.Open()));

    private VoidOrderHandler Void() =>
        new(_data.Open(), TestRequest.As(_userId, AppRoles.Admin, "UTC"), _hub, _audit, _push, TestFakes.Conversations(), TestFakes.Stock(_data.Open()));

    private static OrderItemRequestDto Line(Guid productId, int qty = 1) => new(productId, qty, [], null, null);

    // Only a customer's ordering link can create an order waiting for approval.
    private CreateOrderCommand New(OrderStatusEnum status, params OrderItemRequestDto[] items) =>
        status == OrderStatusEnum.PendingApproval
            ? new() { Status = status, Items = [.. items], Source = OrderSourceEnum.CustomerLink, ActorUserId = _userId }
            : new() { Status = status, Items = [.. items] };

    private static UpdateOrderCommand Change(Guid id, OrderStatusEnum status, params OrderItemRequestDto[] items) =>
        new() { Id = id, Status = status, Items = [.. items] };

    private Guid Limited(Guid productId, int maxRedemptions, decimal percent = 50m, int? maxPerOrder = null)
    {
        using var db = _data.Open();
        var promo = new Promotion
        {
            Id = Guid.NewGuid(),
            Name = "Limited",
            TypeId = PromotionTypeIds.DiscountedProduct,
            IsActive = true,
            MaxRedemptions = maxRedemptions,
            MaxPerOrder = maxPerOrder,
            CreatedAt = DateTime.UtcNow,
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
        db.SaveChanges();
        return promo.Id;
    }

    private async Task<List<OrderItem>> Lines(Guid orderId)
    {
        await using var db = _data.Open();
        return await db.OrderItems.Where(i => i.OrderId == orderId && i.ParentOrderItemId == null).ToListAsync();
    }

    private async Task<decimal> TotalOf(Guid orderId) =>
        (await new GetOrderByIdHandler(_data.Open(), TestRequest.As(_userId, AppRoles.Admin, "UTC"))
            .Handle(new GetOrderByIdQuery(orderId), CancellationToken.None))!.TotalAmount;

    [Theory]
    [InlineData(OrderStatusEnum.Pending)]
    [InlineData(OrderStatusEnum.PendingApproval)]
    public async Task SavingAPendingOrder_HoldsTheUsesButSavesNoPrice(OrderStatusEnum status)
    {
        var croissant = _data.AddProduct("Croissant", 100);
        var promo = Limited(croissant, 5);

        var dto = await Create().Handle(New(status, Line(croissant, 2)), CancellationToken.None);

        var line = (await Lines(dto.Id)).Single();
        line.DiscountPromotionId.ShouldBe(promo);
        line.Price.ShouldBeNull();
        dto.Items.Single().DiscountPromotionId.ShouldBe(promo);
        dto.TotalAmount.ShouldBe(100m);
    }

    [Fact]
    public async Task APendingOrder_TakesTheUsesAwayFromTheNextOrder()
    {
        var croissant = _data.AddProduct("Croissant", 100);
        Limited(croissant, 3);

        var first = await Create().Handle(New(OrderStatusEnum.Pending, Line(croissant, 2)), CancellationToken.None);
        var second = await Create().Handle(New(OrderStatusEnum.Pending, Line(croissant, 2)), CancellationToken.None);
        var third = await Create().Handle(New(OrderStatusEnum.Pending, Line(croissant, 1)), CancellationToken.None);

        (await Lines(first.Id)).Single().DiscountPromotionId.ShouldNotBeNull();
        // Only 1 use was left for the second order: it covers one item and the other pays the full price.
        (await Lines(second.Id)).Select(l => (l.Quantity, l.DiscountPromotionId.HasValue)).ShouldBe([(1, true), (1, false)]);
        (await Lines(third.Id)).Single().DiscountPromotionId.ShouldBeNull("nothing is left for the third order");
        (await TotalOf(first.Id)).ShouldBe(100m);
        (await TotalOf(second.Id)).ShouldBe(50m + 100m);
        (await TotalOf(third.Id)).ShouldBe(100m);
    }

    [Fact]
    public async Task APendingOrder_HoldsOnlyUpToTheLimitPerOrder()
    {
        var croissant = _data.AddProduct("Croissant", 100);
        Limited(croissant, 10, maxPerOrder: 2);

        var first = await Create().Handle(New(OrderStatusEnum.Pending, Line(croissant, 5)), CancellationToken.None);
        var second = await Create().Handle(New(OrderStatusEnum.Pending, Line(croissant, 1)), CancellationToken.None);

        (await Lines(first.Id)).Select(l => (l.Quantity, l.DiscountPromotionId.HasValue)).ShouldBe([(2, true), (3, false)]);
        (await TotalOf(first.Id)).ShouldBe(2 * 50m + 3 * 100m);
        (await TotalOf(second.Id)).ShouldBe(50m);
    }

    [Fact]
    public async Task AnOrderStillSeesItsOwnDiscount_WhenItHoldsEveryUse()
    {
        var croissant = _data.AddProduct("Croissant", 100);
        Limited(croissant, 2);

        var mine = await Create().Handle(New(OrderStatusEnum.Pending, Line(croissant, 2)), CancellationToken.None);
        var other = await Create().Handle(New(OrderStatusEnum.Pending, Line(croissant, 1)), CancellationToken.None);

        (await TotalOf(mine.Id)).ShouldBe(100m);
        (await TotalOf(other.Id)).ShouldBe(100m);
    }

    [Fact]
    public async Task CompletingAnOrderThatHoldsEveryUse_KeepsItsDiscount()
    {
        var croissant = _data.AddProduct("Croissant", 100);
        var promo = Limited(croissant, 2);
        var order = await Create().Handle(New(OrderStatusEnum.Pending, Line(croissant, 2)), CancellationToken.None);

        var done = await Update().Handle(Change(order.Id, OrderStatusEnum.Completed, Line(croissant, 2)), CancellationToken.None);

        done!.TotalAmount.ShouldBe(100m);
        var line = (await Lines(order.Id)).Single();
        line.Price.ShouldBe(50m);
        line.DiscountPromotionId.ShouldBe(promo);
    }

    [Fact]
    public async Task EditingAPendingOrder_MovesItsReservationInsteadOfAddingToIt()
    {
        var croissant = _data.AddProduct("Croissant", 100);
        Limited(croissant, 3);
        var order = await Create().Handle(New(OrderStatusEnum.Pending, Line(croissant, 2)), CancellationToken.None);

        await Update().Handle(Change(order.Id, OrderStatusEnum.Pending, Line(croissant, 3)), CancellationToken.None);
        var other = await Create().Handle(New(OrderStatusEnum.Pending, Line(croissant, 1)), CancellationToken.None);

        (await Lines(order.Id)).Single().DiscountPromotionId.ShouldNotBeNull("3 uses were free for this order's own edit");
        (await Lines(other.Id)).Single().DiscountPromotionId.ShouldBeNull("the edited order now holds all 3");

        await Update().Handle(Change(order.Id, OrderStatusEnum.Pending, Line(croissant, 1)), CancellationToken.None);
        var later = await Create().Handle(New(OrderStatusEnum.Pending, Line(croissant, 2)), CancellationToken.None);

        (await Lines(later.Id)).Single().DiscountPromotionId.ShouldNotBeNull("the edit gave 2 uses back");
    }

    [Fact]
    public async Task AnEditAboveWhatIsLeft_ReservesOnlyTheUsesThatFit()
    {
        var croissant = _data.AddProduct("Croissant", 100);
        Limited(croissant, 3);
        var order = await Create().Handle(New(OrderStatusEnum.Pending, Line(croissant, 1)), CancellationToken.None);

        await Update().Handle(Change(order.Id, OrderStatusEnum.Pending, Line(croissant, 4)), CancellationToken.None);

        // The order gives back the use it held, so 3 are available: 3 items at 50 and one at 100.
        (await Lines(order.Id)).Select(l => (l.Quantity, l.DiscountPromotionId.HasValue)).ShouldBe([(3, true), (1, false)]);
        (await TotalOf(order.Id)).ShouldBe(3 * 50m + 100m);
    }

    [Fact]
    public async Task ACancelledOrder_GivesItsUsesBack()
    {
        var croissant = _data.AddProduct("Croissant", 100);
        Limited(croissant, 2);
        var order = await Create().Handle(New(OrderStatusEnum.Pending, Line(croissant, 2)), CancellationToken.None);
        var blocked = await Create().Handle(New(OrderStatusEnum.Pending, Line(croissant, 1)), CancellationToken.None);
        (await Lines(blocked.Id)).Single().DiscountPromotionId.ShouldBeNull();

        await Void().Handle(new VoidOrderCommand(order.Id), CancellationToken.None);
        var after = await Create().Handle(New(OrderStatusEnum.Pending, Line(croissant, 2)), CancellationToken.None);

        (await Lines(after.Id)).Single().DiscountPromotionId.ShouldNotBeNull();
    }

    [Fact]
    public async Task AnUnlimitedDiscount_ReservesNothingButStillMarksTheLine()
    {
        var croissant = _data.AddProduct("Croissant", 100);
        using (var db = _data.Open())
        {
            var promo = new Promotion
            {
                Id = Guid.NewGuid(),
                Name = "Open",
                TypeId = PromotionTypeIds.DiscountedProduct,
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
                CreatedBy = _userId
            };
            promo.DiscountedProductPromotions.Add(new DiscountedProductPromotion
            {
                Id = Guid.NewGuid(),
                PromotionId = promo.Id,
                ProductId = croissant,
                PercentOff = 10m
            });
            db.Promotions.Add(promo);
            db.SaveChanges();
        }

        var dto = await Create().Handle(New(OrderStatusEnum.Pending, Line(croissant, 50)), CancellationToken.None);
        var next = await Create().Handle(New(OrderStatusEnum.Pending, Line(croissant, 50)), CancellationToken.None);

        (await TotalOf(dto.Id)).ShouldBe(4500m);
        (await TotalOf(next.Id)).ShouldBe(4500m);
    }

    [Fact]
    public async Task AWaitingOrdersUses_AreHeldTooAndGoBackWhenItIsRejected()
    {
        var croissant = _data.AddProduct("Croissant", 100);
        Limited(croissant, 1);
        var waiting = await Create().Handle(New(OrderStatusEnum.PendingApproval, Line(croissant, 1)), CancellationToken.None);
        var other = await Create().Handle(New(OrderStatusEnum.Pending, Line(croissant, 1)), CancellationToken.None);
        (await Lines(other.Id)).Single().DiscountPromotionId.ShouldBeNull("the waiting order holds the last use");

        await using (var db = _data.Open())
        {
            db.Orders.Single(o => o.Id == waiting.Id).StatusId = (int)OrderStatusEnum.Cancelled;
            await db.SaveChangesAsync();
        }

        var after = await Create().Handle(New(OrderStatusEnum.Pending, Line(croissant, 1)), CancellationToken.None);
        (await Lines(after.Id)).Single().DiscountPromotionId.ShouldNotBeNull();
    }

    [Fact]
    public async Task TheCustomerCatalog_HidesADiscountWhoseUsesAreAllHeld()
    {
        var croissant = _data.AddProduct("Croissant", 100);
        var customerId = _data.AddCustomer("Ana", "Cruz");
        Limited(croissant, 2);
        await using (var db = _data.Open())
        {
            db.Customers.Single(c => c.Id == customerId).AllowOrderingLink = true;
            db.ShortLinks.Add(new ShortLink
            {
                Id = Guid.NewGuid(),
                Token = OrderLinkToken.Generate(),
                TargetType = "CustomerOrder",
                TargetId = customerId,
                CreatedAt = DateTime.UtcNow,
                CreatedBy = _userId
            });
            await db.SaveChangesAsync();
        }

        string token;
        await using (var db = _data.Open())
        {
            token = db.ShortLinks.Single().Token;
        }

        Task<PublicDealDto[]> Deals() => OpenDeals(token);

        (await Deals()).Single().Remaining.ShouldBe(2);
        await Create().Handle(New(OrderStatusEnum.Pending, Line(croissant, 1)), CancellationToken.None);
        (await Deals()).Single().Remaining.ShouldBe(1);
        await Create().Handle(New(OrderStatusEnum.Pending, Line(croissant, 1)), CancellationToken.None);
        (await Deals()).ShouldBeEmpty();
    }

    private async Task<PublicDealDto[]> OpenDeals(string token)
    {
        var handler = new GetPublicOrderLinkHandler(_data.Open(), TestRequest.None());
        var dto = await handler.Handle(new GetPublicOrderLinkQuery(token), CancellationToken.None);
        return [.. dto!.Catalog.Deals];
    }
}
