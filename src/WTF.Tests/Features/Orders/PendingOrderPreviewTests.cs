using WTF.Api.Features.Dashboard;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Products.Enums;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Orders;

public class PendingOrderPreviewTests
{
    private readonly OrderSeed _data = new(TestDb.NewName());

    private GetOrdersHandler List() => new(_data.Open(), TestRequest.As(Guid.NewGuid(), timeZone: "UTC"));

    private GetPagedOrdersHandler Paged() => new(_data.Open(), TestRequest.As(Guid.NewGuid(), timeZone: "UTC"));

    private GetOrderByIdHandler ById() => new(_data.Open(), TestRequest.As(Guid.NewGuid(), timeZone: "UTC"));

    private async Task<decimal> TotalOf(Guid orderId) =>
        (await List().Handle(new GetOrdersQuery(), CancellationToken.None)).Single(o => o.Id == orderId).TotalAmount;

    private Guid Discount(Guid productId, decimal? amountOff, decimal? percent, Guid[]? requiredAddOns = null, bool active = true,
        DateTime? end = null, byte? days = null, int? maxRedemptions = null)
    {
        using var db = _data.Open();
        var promo = new Promotion
        {
            Id = Guid.NewGuid(),
            Name = "Disc",
            TypeId = PromotionTypeIds.DiscountedProduct,
            IsActive = active,
            EndDate = end,
            DaysOfWeek = days,
            MaxRedemptions = maxRedemptions,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = Guid.NewGuid()
        };
        var rule = new DiscountedProductPromotion { Id = Guid.NewGuid(), PromotionId = promo.Id, ProductId = productId, FixedPrice = amountOff, PercentOff = percent };
        foreach (var addOn in requiredAddOns ?? [])
        {
            rule.DiscountedProductPromotionAddOns.Add(new DiscountedProductPromotionAddOn { Id = Guid.NewGuid(), DiscountedProductPromotionId = rule.Id, AddOnProductId = addOn, Quantity = 1 });
        }

        promo.DiscountedProductPromotions.Add(rule);
        db.Promotions.Add(promo);
        db.SaveChanges();
        return promo.Id;
    }

    private (Guid Product, Guid Regular, Guid Shot) Menu(decimal price = 120m)
    {
        var product = _data.AddProduct("Espresso", price);
        var regular = _data.AddProduct("Regular", 0m, isAddOn: true);
        var shot = _data.AddProduct("Extra Shot", 25m, isAddOn: true);
        _data.AllowAddOn(product, regular, AddOnTypeEnum.Size);
        _data.AllowAddOn(product, shot);
        return (product, regular, shot);
    }

    private Guid PendingOrder(Guid product, int qty = 1, OrderStatusEnum status = OrderStatusEnum.Pending, params Guid[] addOns)
    {
        var order = _data.AddOrder(status);
        var line = _data.AddLine(order, product, qty);
        foreach (var addOn in addOns)
        {
            _data.AddLine(order, addOn, 1, parentId: line);
        }

        return order;
    }

    [Fact]
    public async Task PendingOrder_WithMatchingRule_ShowsTheDiscountedTotal()
    {
        var m = Menu();
        Discount(m.Product, 20m, null, [m.Regular]);
        var order = PendingOrder(m.Product, 2, addOns: m.Regular);

        (await TotalOf(order)).ShouldBe(200m);
    }

    [Fact]
    public async Task PendingOrder_AmountOffLargerThanThePrice_IsFreeButAddOnsStillCount()
    {
        var m = Menu();
        Discount(m.Product, 150m, null, [m.Regular]);
        var blocked = PendingOrder(m.Product, 1, addOns: [m.Regular, m.Shot]);
        var free = PendingOrder(m.Product, 1, addOns: m.Regular);

        // The rule needs exactly Regular, so the extra shot blocks it.
        (await TotalOf(blocked)).ShouldBe(145m);
        (await TotalOf(free)).ShouldBe(0m);
    }

    [Fact]
    public async Task PendingOrder_RuleWithOtherAddOns_KeepsTheListPrice()
    {
        var m = Menu();
        Discount(m.Product, 20m, null, [m.Shot]);
        var order = PendingOrder(m.Product, 1, addOns: m.Regular);

        (await TotalOf(order)).ShouldBe(120m);
    }

    [Fact]
    public async Task PendingOrder_PlainProductRule_OnlyDiscountsTheProductWithoutAddOns()
    {
        var m = Menu();
        Discount(m.Product, null, 10m);
        var plain = PendingOrder(m.Product);
        var withShot = PendingOrder(m.Product, 1, addOns: m.Shot);

        (await TotalOf(plain)).ShouldBe(108m);
        (await TotalOf(withShot)).ShouldBe(145m);
    }

    [Fact]
    public async Task PendingOrder_PercentDiscount_RoundsToTheCentavo()
    {
        var m = Menu(99.99m);
        Discount(m.Product, null, 15m);
        var order = PendingOrder(m.Product);

        (await TotalOf(order)).ShouldBe(84.99m);
    }

    [Fact]
    public async Task WaitingForApprovalOrder_AlsoShowsTheDiscount()
    {
        var m = Menu();
        Discount(m.Product, null, 50m);
        var order = PendingOrder(m.Product, status: OrderStatusEnum.PendingApproval);

        var dto = await ById().Handle(new GetOrderByIdQuery(order), CancellationToken.None);

        dto!.TotalAmount.ShouldBe(60m);
    }

    [Theory]
    [InlineData(OrderStatusEnum.Completed)]
    [InlineData(OrderStatusEnum.Cancelled)]
    [InlineData(OrderStatusEnum.Refunded)]
    public async Task FinishedOrder_IsNeverRepriced(OrderStatusEnum status)
    {
        var m = Menu();
        Discount(m.Product, null, 50m);
        var order = PendingOrder(m.Product, status: status);

        (await TotalOf(order)).ShouldBe(120m);
    }

    [Fact]
    public async Task PendingLine_WithASavedPrice_KeepsIt()
    {
        var m = Menu();
        Discount(m.Product, null, 50m);
        var order = _data.AddOrder();
        _data.AddLine(order, m.Product, 1, price: 100m);

        (await TotalOf(order)).ShouldBe(100m);
    }

    [Fact]
    public async Task BundleLines_AreNotDiscounted()
    {
        var m = Menu();
        Discount(m.Product, null, 50m);
        var bundle = _data.AddFixedBundle("Combo", 90m, productId: m.Product);
        var order = _data.AddOrder();
        _data.AddLine(order, m.Product, 1, bundleId: bundle);
        using (var db = _data.Open())
        {
            db.OrderBundlePromotions.Add(new OrderBundlePromotion { Id = Guid.NewGuid(), OrderId = order, PromotionId = bundle, Quantity = 1, UnitPrice = 90m });
            db.SaveChanges();
        }

        (await TotalOf(order)).ShouldBe(90m);
    }

    [Fact]
    public async Task InactiveOrEndedPromotion_IsIgnored()
    {
        var m = Menu();
        Discount(m.Product, null, 50m, active: false);
        Discount(m.Product, null, 50m, end: DateTime.UtcNow.AddDays(-2));
        var order = PendingOrder(m.Product);

        (await TotalOf(order)).ShouldBe(120m);
    }

    [Fact]
    public async Task PromotionClosedToday_IsIgnored_AndOpenToday_Applies()
    {
        var m = Menu();
        var today = (int)DateTime.UtcNow.DayOfWeek;
        var otherDay = (byte)(1 << ((today + 1) % 7));
        var thisDay = (byte)(1 << today);
        var closed = Discount(m.Product, null, 50m, days: otherDay);
        var order = PendingOrder(m.Product);
        (await TotalOf(order)).ShouldBe(120m);

        using (var db = _data.Open())
        {
            db.Promotions.Single(p => p.Id == closed).DaysOfWeek = thisDay;
            db.SaveChanges();
        }

        (await TotalOf(order)).ShouldBe(60m);
    }

    [Fact]
    public async Task BestOfSeveralRules_Wins()
    {
        var m = Menu();
        Discount(m.Product, null, 10m);
        Discount(m.Product, 50m, null);
        var order = PendingOrder(m.Product);

        (await TotalOf(order)).ShouldBe(70m);
    }

    [Fact]
    public async Task UsageLimit_CoversOnlyTheItemsItHasUsesFor()
    {
        var m = Menu();
        var promo = Discount(m.Product, null, 50m, maxRedemptions: 3);
        var done = _data.AddOrder(OrderStatusEnum.Completed);
        var line = _data.AddLine(done, m.Product, 2, price: 60m, originalPrice: 120m);
        using (var db = _data.Open())
        {
            db.OrderItems.Single(i => i.Id == line).DiscountPromotionId = promo;
            db.SaveChanges();
        }

        var two = PendingOrder(m.Product, 2);
        var one = PendingOrder(m.Product, 1);

        // One use is left: two items get it for one and pay the full price for the other.
        (await TotalOf(two)).ShouldBe(60m + 120m);
        (await TotalOf(one)).ShouldBe(60m);
    }

    [Fact]
    public async Task UsageLimit_IsSharedByTheLinesOfOneOrder_ButNotByOtherPendingOrders()
    {
        var m = Menu();
        Discount(m.Product, null, 50m, maxRedemptions: 1);
        var order = _data.AddOrder();
        _data.AddLine(order, m.Product, 1);
        _data.AddLine(order, m.Product, 1, sortOrder: 1);
        var other = PendingOrder(m.Product);

        // Nothing is used up until an order really completes, so each pending order is judged on its own.
        (await TotalOf(order)).ShouldBe(60m + 120m);
        (await TotalOf(other)).ShouldBe(60m);
    }

    [Fact]
    public async Task PagedAndSingleReads_AgreeWithTheList()
    {
        var m = Menu();
        Discount(m.Product, 20m, null);
        var order = PendingOrder(m.Product, 3);

        var paged = await Paged().Handle(new GetPagedOrdersQuery(), CancellationToken.None);
        var single = await ById().Handle(new GetOrderByIdQuery(order), CancellationToken.None);

        paged.Items.Single(o => o.Id == order).TotalAmount.ShouldBe(300m);
        single!.TotalAmount.ShouldBe(300m);
    }

    [Fact]
    public async Task ListLinePrices_AreStillTheListPrices()
    {
        var m = Menu();
        Discount(m.Product, 20m, null);
        var order = PendingOrder(m.Product);

        var dto = (await List().Handle(new GetOrdersQuery(), CancellationToken.None)).Single(o => o.Id == order);

        dto.Items.Single().Price.ShouldBe(120m);
        dto.Items.Single().PromoLabel.ShouldBeNull();
    }

    [Fact]
    public async Task WithoutARequest_TheRulesStillApply()
    {
        var m = Menu();
        Discount(m.Product, null, 50m);
        var order = PendingOrder(m.Product);

        var dto = await new GetOrderByIdHandler(_data.Open()).Handle(new GetOrderByIdQuery(order), CancellationToken.None);

        dto!.TotalAmount.ShouldBe(60m);
    }

    [Fact]
    public async Task DashboardRecentOrders_ShowTheSameTotal()
    {
        var m = Menu();
        Discount(m.Product, null, 50m);
        using (var seed = _data.Open())
        {
            seed.Statuses.AddRange(
                new Status { Id = 1, Name = "Pending" }, new Status { Id = 2, Name = "Completed" },
                new Status { Id = 3, Name = "Cancelled" }, new Status { Id = 4, Name = "Refunded" },
                new Status { Id = 5, Name = "PendingApproval" });
            seed.SaveChanges();
        }

        var order = _data.AddOrder(createdAt: DateTime.UtcNow.AddMinutes(-1));
        _data.AddLine(order, m.Product, 1);

        var dto = await new GetDashboardHandler(_data.Open(), TestRequest.As(Guid.NewGuid(), timeZone: "UTC"))
            .Handle(new GetDashboardQuery("last30days", null, null), CancellationToken.None);

        dto.RecentOrders.Single().TotalAmount.ShouldBe(60m);
    }
}
