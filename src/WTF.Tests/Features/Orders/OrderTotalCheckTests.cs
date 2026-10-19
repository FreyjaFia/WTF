using Microsoft.AspNetCore.SignalR;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Orders;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Orders;

// The register sends the total the cashier collected against. If the server works out another total, the sale is refused.
public class OrderTotalCheckTests
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

    private static OrderItemRequestDto Line(Guid productId, int qty = 1) => new(productId, qty, [], null, null);

    [Theory]
    [InlineData(null, true)]
    [InlineData(200.0, true)]
    [InlineData(199.99, false)]
    [InlineData(200.01, false)]
    [InlineData(100.0, false)]
    public async Task CompletingANewSale_IsRefusedWhenTheTotalIsNotTheOneTheRegisterSaw(double? expected, bool accepted)
    {
        var burger = _data.AddProduct("Burger", 100);
        var command = new CreateOrderCommand
        {
            Status = OrderStatusEnum.Completed,
            Items = [Line(burger, 2)],
            ExpectedTotal = expected.HasValue ? (decimal)expected.Value : null
        };

        if (accepted)
        {
            (await Create().Handle(command, CancellationToken.None)).TotalAmount.ShouldBe(200m);
        }
        else
        {
            var ex = await Should.ThrowAsync<InvalidOperationException>(() => Create().Handle(command, CancellationToken.None));
            ex.Message.ShouldContain("The total changed to PHP 200.00");
        }
    }

    [Fact]
    public async Task ThePriceChangingBetweenCartAndCheckout_RefusesTheSale()
    {
        var burger = _data.AddProduct("Burger", 100);
        await using (var db = _data.Open())
        {
            db.Products.Single(p => p.Id == burger).Price = 120m;
            await db.SaveChangesAsync();
        }

        var command = new CreateOrderCommand { Status = OrderStatusEnum.Completed, Items = [Line(burger)], ExpectedTotal = 100m };

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Create().Handle(command, CancellationToken.None));
        ex.Message.ShouldContain("PHP 120.00");
    }

    [Fact]
    public async Task ASavedOpenOrder_IsNotChecked()
    {
        var burger = _data.AddProduct("Burger", 100);
        var command = new CreateOrderCommand { Status = OrderStatusEnum.Pending, Items = [Line(burger)], ExpectedTotal = 1m };

        (await Create().Handle(command, CancellationToken.None)).TotalAmount.ShouldBe(100m);
    }

    [Fact]
    public async Task AnOfflineHeldOrder_IsNotChecked()
    {
        var burger = _data.AddProduct("Burger", 100);
        var command = new CreateOrderCommand
        {
            Status = OrderStatusEnum.Completed,
            Items = [new OrderItemRequestDto(burger, 1, [], null, null, 90m, 100m, null)],
            ExpectedTotal = 1m,
            HeldReasons = ["Burger now costs 100.00, quoted 90.00."],
            OfflineLocalId = "OFF-1"
        };

        var dto = await Create().Handle(command, CancellationToken.None);

        dto.Status.ShouldBe(OrderStatusEnum.PendingReview);
        dto.TotalAmount.ShouldBe(90m);
    }

    [Theory]
    [InlineData(100.0, true)]
    [InlineData(99.0, false)]
    public async Task CompletingAnOpenOrder_IsRefusedWhenTheTotalIsNotTheOneTheRegisterSaw(double expected, bool accepted)
    {
        var burger = _data.AddProduct("Burger", 100);
        var order = _data.AddOrder();
        _data.AddLine(order, burger, 1);
        var command = new UpdateOrderCommand
        {
            Id = order,
            Status = OrderStatusEnum.Completed,
            Items = [Line(burger)],
            ExpectedTotal = (decimal)expected
        };

        if (accepted)
        {
            (await Update().Handle(command, CancellationToken.None))!.Status.ShouldBe(OrderStatusEnum.Completed);
        }
        else
        {
            await Should.ThrowAsync<InvalidOperationException>(() => Update().Handle(command, CancellationToken.None));
            await using var db = _data.Open();
            db.Orders.Single(o => o.Id == order).StatusId.ShouldBe((int)OrderStatusEnum.Pending, "the order is untouched");
        }
    }

    [Fact]
    public async Task CompletingAnOpenOrderWithABundle_CountsTheBundlePriceInTheCheck()
    {
        var burger = _data.AddProduct("Burger", 100);
        var bundle = _data.AddFixedBundle("Combo", 150, productId: burger);
        var order = _data.AddOrder();
        _data.AddLine(order, burger, 1, bundleId: bundle);
        var bundleLine = new OrderItemRequestDto(burger, 1, [], null, bundle);
        var command = new UpdateOrderCommand
        {
            Id = order,
            Status = OrderStatusEnum.Completed,
            Items = [bundleLine],
            BundlePromotions = [new OrderBundlePromotionRequestDto(bundle, 1)],
            ExpectedTotal = 150m
        };

        (await Update().Handle(command, CancellationToken.None))!.TotalAmount.ShouldBe(150m);
    }

    [Fact]
    public async Task ACorrectionToACompletedOrder_IsNotChecked()
    {
        var burger = _data.AddProduct("Burger", 100);
        var order = _data.AddOrder(OrderStatusEnum.Completed);
        _data.AddLine(order, burger, 1, price: 100m);
        var command = new UpdateOrderCommand
        {
            Id = order,
            Status = OrderStatusEnum.Completed,
            Items = [Line(burger, 2)],
            ExpectedTotal = 1m,
            IsOverride = true,
            OverrideReason = "wrong quantity"
        };

        (await Update().Handle(command, CancellationToken.None))!.TotalAmount.ShouldBe(200m);
    }

    [Fact]
    public async Task TwoSalesCompletedAtTheSameMoment_CannotBothTakeTheLastUseOfAPromotion()
    {
        var croissant = _data.AddProduct("Croissant", 100);
        await using (var db = _data.Open())
        {
            var promo = new Promotion
            {
                Id = Guid.NewGuid(),
                Name = "Last one",
                TypeId = PromotionTypeIds.DiscountedProduct,
                IsActive = true,
                MaxRedemptions = 1,
                CreatedAt = DateTime.UtcNow,
                CreatedBy = _userId
            };
            promo.DiscountedProductPromotions.Add(new DiscountedProductPromotion
            {
                Id = Guid.NewGuid(),
                PromotionId = promo.Id,
                ProductId = croissant,
                PercentOff = 50m
            });
            db.Promotions.Add(promo);
            await db.SaveChangesAsync();
        }

        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ =>
            Create().Handle(new CreateOrderCommand { Status = OrderStatusEnum.Completed, Items = [Line(croissant)] }, CancellationToken.None)));

        results.Count(r => r.TotalAmount == 50m).ShouldBe(1, "only one sale gets the single use");
        results.Count(r => r.TotalAmount == 100m).ShouldBe(7);
        await using var check = _data.Open();
        check.OrderItems.Count(i => i.DiscountPromotionId != null).ShouldBe(1);
    }

    [Fact]
    public async Task TheGate_LetsOnlyOneHolderInAtATime_AndReleasesTwiceSafely()
    {
        var inside = 0;
        var overlap = false;

        async Task Work()
        {
            using var gate = await PromotionLimitGate.EnterAsync(CancellationToken.None);
            if (Interlocked.Increment(ref inside) > 1)
            {
                overlap = true;
            }

            await Task.Delay(5);
            Interlocked.Decrement(ref inside);
            gate.Dispose();
        }

        await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => Work()));

        overlap.ShouldBeFalse();
        using var again = await PromotionLimitGate.EnterAsync(CancellationToken.None);
    }
}
