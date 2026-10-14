using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Products.Enums;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Orders;

public class CreateOrderHandlerTests
{
    private static readonly DateTime Now = new(2026, 6, 10, 12, 0, 0, DateTimeKind.Utc);

    private readonly Guid _userId = Guid.NewGuid();
    private readonly string _dbName = TestDb.NewName();
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly IPushNotificationService _push = TestFakes.Push();
    private readonly IHubContext<DashboardHub> _hub = TestFakes.Hub();
    private readonly IConversationNotifier _conversations = TestFakes.Conversations();

    private CreateOrderHandler Handler(string? timeZone = null) =>
        new(TestDb.Create(_dbName), TestRequest.As(_userId, AppRoles.Admin, timeZone), _hub, _audit, _push, _conversations);

    private static OrderItemRequestDto Line(Guid productId, int qty = 1, Guid? bundle = null, string? note = null, params OrderItemRequestDto[] addOns) =>
        new(productId, qty, [.. addOns], note, bundle);

    private static OrderItemRequestDto AddOn(Guid productId, int qty = 1) => new(productId, qty, [], null, null);

    private static CreateOrderCommand Cmd(OrderStatusEnum status, params OrderItemRequestDto[] items) =>
        new() { Status = status, Items = [.. items] };

    private async Task<Guid> SeedCustomer(bool active = true)
    {
        await using var db = TestDb.Create(_dbName);
        var customer = Features.Customers.CustomerSeed.NewCustomer(isActive: active);
        db.Customers.Add(customer);
        await db.SaveChangesAsync();
        return customer.Id;
    }

    private async Task<Guid> SeedProduct(string name, decimal price, bool active = true, bool isAddOn = false)
    {
        await using var db = TestDb.Create(_dbName);
        var p = new Product { Id = Guid.NewGuid(), Name = name, Price = price, IsActive = active, IsAddOn = isAddOn, Code = name, CreatedAt = Now, CreatedBy = _userId };
        db.Products.Add(p);
        await db.SaveChangesAsync();
        return p.Id;
    }

    private async Task Link(Guid productId, Guid addOnId, AddOnTypeEnum? type = AddOnTypeEnum.Extra, bool active = true, decimal? overridePrice = null, bool overrideActive = true)
    {
        await using var db = TestDb.Create(_dbName);
        db.ProductAddOns.Add(new ProductAddOn { ProductId = productId, AddOnId = addOnId, AddOnTypeId = type.HasValue ? (int)type.Value : null, IsActive = active });
        if (overridePrice.HasValue)
        {
            db.ProductAddOnPriceOverrides.Add(new ProductAddOnPriceOverride
            {
                Id = Guid.NewGuid(),
                ProductId = productId,
                AddOnId = addOnId,
                Price = overridePrice.Value,
                IsActive = overrideActive,
                CreatedAt = Now
            });
        }
        await db.SaveChangesAsync();
    }

    private async Task<Guid> SeedBundle(decimal price, bool mixMatch = false, bool active = true, DateTime? start = null, DateTime? end = null, string name = "Bundle")
    {
        await using var db = TestDb.Create(_dbName);
        var promo = new Promotion
        {
            Id = Guid.NewGuid(),
            Name = name,
            TypeId = mixMatch ? PromotionTypeIds.MixMatch : PromotionTypeIds.FixedBundle,
            IsActive = active,
            StartDate = start,
            EndDate = end,
            CreatedAt = Now,
            CreatedBy = _userId
        };
        if (mixMatch)
            promo.MixMatchPromotion = new MixMatchPromotion { PromotionId = promo.Id, RequiredQuantity = 2, BundlePrice = price };
        else
            promo.FixedBundlePromotion = new FixedBundlePromotion { PromotionId = promo.Id, BundlePrice = price };
        db.Promotions.Add(promo);
        await db.SaveChangesAsync();
        return promo.Id;
    }

    private async Task<Guid> SeedDiscount(Guid productId, decimal? fixedPrice, decimal? percent, (Guid AddOn, int Qty)[]? required = null,
        bool active = true, DateTime? start = null, DateTime? end = null)
    {
        await using var db = TestDb.Create(_dbName);
        var promo = new Promotion
        {
            Id = Guid.NewGuid(),
            Name = "Disc",
            TypeId = PromotionTypeIds.DiscountedProduct,
            IsActive = active,
            StartDate = start,
            EndDate = end,
            CreatedAt = Now,
            CreatedBy = _userId
        };
        var rule = new DiscountedProductPromotion { Id = Guid.NewGuid(), PromotionId = promo.Id, ProductId = productId, FixedPrice = fixedPrice, PercentOff = percent };
        foreach (var (addOn, qty) in required ?? [])
        {
            rule.DiscountedProductPromotionAddOns.Add(new DiscountedProductPromotionAddOn { Id = Guid.NewGuid(), DiscountedProductPromotionId = rule.Id, AddOnProductId = addOn, Quantity = qty });
        }
        promo.DiscountedProductPromotions.Add(rule);
        db.Promotions.Add(promo);
        await db.SaveChangesAsync();
        return promo.Id;
    }

    private async Task<Order> LoadOrder(Guid id)
    {
        await using var db = TestDb.Create(_dbName);
        return await db.Orders.AsNoTracking().Include(o => o.OrderItems).Include(o => o.OrderBundlePromotions).SingleAsync(o => o.Id == id);
    }

    private async Task AssertNothingSaved()
    {
        await using var db = TestDb.Create(_dbName);
        (await db.Orders.CountAsync()).ShouldBe(0);
        (await db.OrderItems.CountAsync()).ShouldBe(0);
    }

    // ---------- basic order ----------

    [Fact]
    public async Task Handle_SimplePendingOrder_SavesOrderAndReturnsDto()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var customer = await SeedCustomer();
        var cmd = Cmd(OrderStatusEnum.Pending, Line(pizza, 2)) with { CustomerId = customer, SpecialInstructions = "no onions" };

        var dto = await Handler().Handle(cmd, CancellationToken.None);

        dto.Status.ShouldBe(OrderStatusEnum.Pending);
        dto.CreatedBy.ShouldBe(_userId);
        dto.CustomerId.ShouldBe(customer);
        dto.SpecialInstructions.ShouldBe("no onions");
        dto.TotalAmount.ShouldBe(200m);
        dto.Items.Count.ShouldBe(1);
        dto.Items[0].ProductName.ShouldBe("Pizza");
        dto.Items[0].Quantity.ShouldBe(2);
        dto.BundlePromotions.ShouldNotBeNull();
        dto.BundlePromotions!.ShouldBeEmpty();

        var saved = await LoadOrder(dto.Id);
        saved.CreatedBy.ShouldBe(_userId);
        saved.CustomerId.ShouldBe(customer);
        saved.StatusId.ShouldBe((int)OrderStatusEnum.Pending);
        saved.OrderItems.Count.ShouldBe(1);
    }

    [Fact]
    public async Task Handle_TellsTheOrdersHubSoStaffWithoutTheDashboardSeeTheNewOrder()
    {
        var pizza = await SeedProduct("Pizza", 100m);

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza)), CancellationToken.None);

        await _conversations.Received(1).OrderChangedAsync(
            Arg.Is<WTF.Domain.Entities.Order>(o => o.Id == dto.Id), null, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_NoCreatedAt_UsesCurrentUtcTime()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var before = DateTime.UtcNow;

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza)), CancellationToken.None);

        dto.CreatedAt.ShouldBeInRange(before, DateTime.UtcNow);
    }

    [Fact]
    public async Task Handle_OfflineCreatedAt_IsUsedAsUtc()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var offline = new DateTime(2026, 1, 5, 8, 30, 0, DateTimeKind.Utc);

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza)) with { CreatedAt = offline }, CancellationToken.None);

        dto.CreatedAt.ShouldBe(offline);
        (await LoadOrder(dto.Id)).CreatedAt.ShouldBe(offline);
    }

    [Fact]
    public async Task Handle_OfflineCreatedAtInLocalKind_IsConvertedToUtc()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var local = new DateTime(2026, 1, 5, 16, 0, 0, DateTimeKind.Local);

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza)) with { CreatedAt = local }, CancellationToken.None);

        dto.CreatedAt.ShouldBe(local.ToUniversalTime());
    }

    [Fact]
    public async Task Handle_NoteWithWhitespace_IsTrimmed()
    {
        var pizza = await SeedProduct("Pizza", 100m);

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza)) with { Note = "  call first  " }, CancellationToken.None);

        dto.Note.ShouldBe("call first");
        (await LoadOrder(dto.Id)).Note.ShouldBe("call first");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Handle_BlankNote_IsStoredAsNull(string? note)
    {
        var pizza = await SeedProduct("Pizza", 100m);

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza)) with { Note = note }, CancellationToken.None);

        dto.Note.ShouldBeNull();
        (await LoadOrder(dto.Id)).Note.ShouldBeNull();
    }

    // ---------- payment ----------

    [Fact]
    public async Task Handle_PaymentFields_ArePersisted()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var cmd = Cmd(OrderStatusEnum.Completed, Line(pizza)) with
        {
            PaymentMethod = PaymentMethodEnum.GCash,
            AmountReceived = 150m,
            ChangeAmount = 40m,
            Tips = 10m
        };

        var dto = await Handler().Handle(cmd, CancellationToken.None);

        dto.PaymentMethod.ShouldBe(PaymentMethodEnum.GCash);
        dto.AmountReceived.ShouldBe(150m);
        dto.ChangeAmount.ShouldBe(40m);
        dto.Tips.ShouldBe(10m);
        var saved = await LoadOrder(dto.Id);
        saved.PaymentMethodId.ShouldBe((int)PaymentMethodEnum.GCash);
        saved.AmountReceived.ShouldBe(150m);
        saved.ChangeAmount.ShouldBe(40m);
        saved.Tips.ShouldBe(10m);
    }

    [Fact]
    public async Task Handle_NoPayment_LeavesPaymentFieldsNull()
    {
        var pizza = await SeedProduct("Pizza", 100m);

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza)), CancellationToken.None);

        dto.PaymentMethod.ShouldBeNull();
        dto.AmountReceived.ShouldBeNull();
        dto.ChangeAmount.ShouldBeNull();
        dto.Tips.ShouldBeNull();
        (await LoadOrder(dto.Id)).PaymentMethodId.ShouldBeNull();
    }

    [Theory]
    [InlineData(OrderStatusEnum.Pending)]
    [InlineData(OrderStatusEnum.Completed)]
    [InlineData(OrderStatusEnum.Cancelled)]
    public async Task Handle_Status_IsStoredAsRequested(OrderStatusEnum status)
    {
        var pizza = await SeedProduct("Pizza", 100m);

        var dto = await Handler().Handle(Cmd(status, Line(pizza)), CancellationToken.None);

        dto.Status.ShouldBe(status);
        (await LoadOrder(dto.Id)).StatusId.ShouldBe((int)status);
    }

    // ---------- price snapshots ----------

    [Fact]
    public async Task Handle_PendingOrder_DoesNotSnapshotPrices()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var cheese = await SeedProduct("Cheese", 20m, isAddOn: true);
        await Link(pizza, cheese);

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza, 1, null, null, AddOn(cheese))), CancellationToken.None);

        var saved = await LoadOrder(dto.Id);
        saved.OrderItems.ShouldAllBe(i => i.Price == null && i.OriginalPrice == null && i.PromoLabel == null);
        dto.TotalAmount.ShouldBe(120m);
    }

    [Theory]
    [InlineData(OrderStatusEnum.Completed)]
    [InlineData(OrderStatusEnum.Cancelled)]
    public async Task Handle_CompletedOrCancelled_SnapshotsPrices(OrderStatusEnum status)
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var cheese = await SeedProduct("Cheese", 20m, isAddOn: true);
        await Link(pizza, cheese);

        var dto = await Handler().Handle(Cmd(status, Line(pizza, 1, null, null, AddOn(cheese))), CancellationToken.None);

        var saved = await LoadOrder(dto.Id);
        var parent = saved.OrderItems.Single(i => i.ParentOrderItemId == null);
        var child = saved.OrderItems.Single(i => i.ParentOrderItemId != null);
        parent.Price.ShouldBe(100m);
        parent.OriginalPrice.ShouldBe(100m);
        parent.PromoLabel.ShouldBeNull();
        child.Price.ShouldBe(20m);
    }

    [Fact]
    public async Task Handle_CompletedOrder_PriceSnapshotSurvivesLaterProductPriceChange()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Completed, Line(pizza)), CancellationToken.None);

        await using (var db = TestDb.Create(_dbName))
        {
            (await db.Products.SingleAsync()).Price = 500m;
            await db.SaveChangesAsync();
        }

        (await LoadOrder(dto.Id)).OrderItems.Single().Price.ShouldBe(100m);
    }

    [Fact]
    public async Task Handle_DiscountedProductFixedAmount_SnapshotsDiscountAndLabel()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var cheese = await SeedProduct("Cheese", 20m, isAddOn: true);
        await Link(pizza, cheese);
        await SeedDiscount(pizza, 30m, null, [(cheese, 1)]);

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Completed, Line(pizza, 2, null, null, AddOn(cheese))), CancellationToken.None);

        var parent = dto.Items.Single();
        parent.Price.ShouldBe(70m);
        parent.OriginalPrice.ShouldBe(100m);
        parent.PromoLabel.ShouldBe("Promo -₱30.00");
        dto.TotalAmount.ShouldBe((70m + 20m) * 2);
    }

    [Fact]
    public async Task Handle_DiscountedProductPercentOff_RoundsAwayFromZero()
    {
        var pizza = await SeedProduct("Pizza", 99.99m);
        var cheese = await SeedProduct("Cheese", 20m, isAddOn: true);
        await Link(pizza, cheese);
        await SeedDiscount(pizza, null, 15m, [(cheese, 1)]);

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Completed, Line(pizza, 1, null, null, AddOn(cheese))), CancellationToken.None);

        // 99.99 * 0.85 = 84.9915 -> 84.99
        dto.Items.Single().Price.ShouldBe(84.99m);
        dto.Items.Single().PromoLabel.ShouldBe("Promo -15%");
    }

    [Fact]
    public async Task Handle_DiscountExceedingPrice_ClampsPriceToZero()
    {
        var pizza = await SeedProduct("Pizza", 50m);
        var cheese = await SeedProduct("Cheese", 0m, isAddOn: true);
        await Link(pizza, cheese);
        await SeedDiscount(pizza, 80m, null, [(cheese, 1)]);

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Completed, Line(pizza, 1, null, null, AddOn(cheese))), CancellationToken.None);

        dto.Items.Single().Price.ShouldBe(0m);
        dto.Items.Single().OriginalPrice.ShouldBe(50m);
    }

    [Fact]
    public async Task Handle_PendingOrderWithDiscountedProduct_DoesNotApplyDiscount()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var cheese = await SeedProduct("Cheese", 20m, isAddOn: true);
        await Link(pizza, cheese);
        await SeedDiscount(pizza, 30m, null, [(cheese, 1)]);

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza, 1, null, null, AddOn(cheese))), CancellationToken.None);

        dto.Items.Single().Price.ShouldBeNull();
        dto.Items.Single().PromoLabel.ShouldBeNull();
        dto.TotalAmount.ShouldBe(120m);
    }

    [Fact]
    public async Task Handle_DiscountRequiresDifferentAddOns_IsNotApplied()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var cheese = await SeedProduct("Cheese", 20m, isAddOn: true);
        var bacon = await SeedProduct("Bacon", 25m, isAddOn: true);
        await Link(pizza, cheese);
        await Link(pizza, bacon);
        await SeedDiscount(pizza, 30m, null, [(cheese, 1)]);

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Completed, Line(pizza, 1, null, null, AddOn(bacon))), CancellationToken.None);

        dto.Items.Single().Price.ShouldBe(100m);
        dto.Items.Single().PromoLabel.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_DiscountRequiresExactAddOnQuantity_WrongQuantityNotApplied()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var cheese = await SeedProduct("Cheese", 20m, isAddOn: true);
        await Link(pizza, cheese);
        await SeedDiscount(pizza, 30m, null, [(cheese, 1)]);

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Completed, Line(pizza, 1, null, null, AddOn(cheese, 2))), CancellationToken.None);

        dto.Items.Single().Price.ShouldBe(100m);
    }

    [Fact]
    public async Task Handle_DiscountWithExtraAddOn_IsNotApplied()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var cheese = await SeedProduct("Cheese", 20m, isAddOn: true);
        var bacon = await SeedProduct("Bacon", 25m, isAddOn: true);
        await Link(pizza, cheese);
        await Link(pizza, bacon);
        await SeedDiscount(pizza, 30m, null, [(cheese, 1)]);

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Completed, Line(pizza, 1, null, null, AddOn(cheese), AddOn(bacon))), CancellationToken.None);

        dto.Items.Single().Price.ShouldBe(100m);
    }

    [Fact]
    public async Task Handle_TwoMatchingDiscounts_BestPriceWins()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var cheese = await SeedProduct("Cheese", 20m, isAddOn: true);
        await Link(pizza, cheese);
        await SeedDiscount(pizza, 10m, null, [(cheese, 1)]);
        await SeedDiscount(pizza, null, 50m, [(cheese, 1)]);

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Completed, Line(pizza, 1, null, null, AddOn(cheese))), CancellationToken.None);

        dto.Items.Single().Price.ShouldBe(50m);
        dto.Items.Single().PromoLabel.ShouldBe("Promo -50%");
    }

    [Fact]
    public async Task Handle_InactiveDiscountPromotion_IsIgnored()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var cheese = await SeedProduct("Cheese", 20m, isAddOn: true);
        await Link(pizza, cheese);
        await SeedDiscount(pizza, 30m, null, [(cheese, 1)], active: false);

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Completed, Line(pizza, 1, null, null, AddOn(cheese))), CancellationToken.None);

        dto.Items.Single().Price.ShouldBe(100m);
    }

    [Fact]
    public async Task Handle_DiscountOutsideDateRange_IsIgnored()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var cheese = await SeedProduct("Cheese", 20m, isAddOn: true);
        await Link(pizza, cheese);
        await SeedDiscount(pizza, 30m, null, [(cheese, 1)], start: Now.AddDays(5), end: Now.AddDays(10));

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Completed, Line(pizza, 1, null, null, AddOn(cheese))) with { CreatedAt = Now }, CancellationToken.None);

        dto.Items.Single().Price.ShouldBe(100m);
    }

    [Fact]
    public async Task Handle_OfflineCreatedAtInsideDiscountWindow_AppliesDiscount()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var cheese = await SeedProduct("Cheese", 20m, isAddOn: true);
        await Link(pizza, cheese);
        // The promotion only ran in the past; the offline order was placed during that window.
        await SeedDiscount(pizza, 30m, null, [(cheese, 1)], start: new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc), end: new DateTime(2026, 1, 31, 0, 0, 0, DateTimeKind.Utc));
        var offline = new DateTime(2026, 1, 15, 10, 0, 0, DateTimeKind.Utc);

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Completed, Line(pizza, 1, null, null, AddOn(cheese))) with { CreatedAt = offline }, CancellationToken.None);

        dto.Items.Single().Price.ShouldBe(70m);
    }

    [Fact]
    public async Task Handle_TimeZoneHeader_DecidesWhetherPromotionEndedLocally()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var cheese = await SeedProduct("Cheese", 20m, isAddOn: true);
        await Link(pizza, cheese);
        // Ends 10 Jun 10:00 UTC. At 10 Jun 20:00 UTC it is still 10 Jun in UTC but already 11 Jun in Manila (UTC+8).
        await SeedDiscount(pizza, 30m, null, [(cheese, 1)], end: new DateTime(2026, 6, 10, 10, 0, 0, DateTimeKind.Utc));
        var reference = new DateTime(2026, 6, 10, 20, 0, 0, DateTimeKind.Utc);
        var cmd = Cmd(OrderStatusEnum.Completed, Line(pizza, 1, null, null, AddOn(cheese))) with { CreatedAt = reference };

        var utc = await Handler().Handle(cmd, CancellationToken.None);
        var manila = await Handler("Asia/Manila").Handle(cmd, CancellationToken.None);

        utc.Items.Single().Price.ShouldBe(70m);
        manila.Items.Single().Price.ShouldBe(100m);
    }

    [Fact]
    public async Task Handle_UnknownTimeZoneHeader_FallsBackToUtc()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var cheese = await SeedProduct("Cheese", 20m, isAddOn: true);
        await Link(pizza, cheese);
        await SeedDiscount(pizza, 30m, null, [(cheese, 1)], end: new DateTime(2026, 6, 10, 10, 0, 0, DateTimeKind.Utc));
        var cmd = Cmd(OrderStatusEnum.Completed, Line(pizza, 1, null, null, AddOn(cheese))) with { CreatedAt = new DateTime(2026, 6, 10, 20, 0, 0, DateTimeKind.Utc) };

        var dto = await Handler("Not/AZone").Handle(cmd, CancellationToken.None);

        dto.Items.Single().Price.ShouldBe(70m);
    }

    // ---------- add-ons ----------

    [Fact]
    public async Task Handle_AddOns_AreSavedAsChildRowsOfTheirParent()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var cheese = await SeedProduct("Cheese", 20m, isAddOn: true);
        var bacon = await SeedProduct("Bacon", 25m, isAddOn: true);
        await Link(pizza, cheese);
        await Link(pizza, bacon);

        var dto = await Handler().Handle(
            Cmd(OrderStatusEnum.Pending, Line(pizza, 2, null, "well done", AddOn(cheese, 1), AddOn(bacon, 2))), CancellationToken.None);

        var saved = await LoadOrder(dto.Id);
        var parent = saved.OrderItems.Single(i => i.ParentOrderItemId == null);
        parent.ProductId.ShouldBe(pizza);
        parent.Quantity.ShouldBe(2);
        parent.SpecialInstructions.ShouldBe("well done");
        var children = saved.OrderItems.Where(i => i.ParentOrderItemId == parent.Id).ToList();
        children.Count.ShouldBe(2);
        children.Single(c => c.ProductId == bacon).Quantity.ShouldBe(2);
        children.ShouldAllBe(c => c.OrderId == dto.Id);

        dto.Items.Single().AddOns.Count.ShouldBe(2);
        // (100 + 20*1 + 25*2) * 2
        dto.TotalAmount.ShouldBe(340m);
    }

    [Fact]
    public async Task Handle_MultipleLines_KeepRequestOrderViaSortOrder()
    {
        var a = await SeedProduct("A", 10m);
        var b = await SeedProduct("B", 20m);
        var c = await SeedProduct("C", 30m);

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(c), Line(a), Line(b)), CancellationToken.None);

        dto.Items.Select(i => i.ProductName).ShouldBe(["C", "A", "B"]);
        (await LoadOrder(dto.Id)).OrderItems.OrderBy(i => i.SortOrder).Select(i => i.ProductId).ShouldBe([c, a, b]);
        dto.TotalAmount.ShouldBe(60m);
    }

    [Fact]
    public async Task Handle_AddOnPriceOverride_IsUsedForSnapshotAndTotal()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var cheese = await SeedProduct("Cheese", 20m, isAddOn: true);
        await Link(pizza, cheese, overridePrice: 5m);

        var completed = await Handler().Handle(Cmd(OrderStatusEnum.Completed, Line(pizza, 1, null, null, AddOn(cheese))), CancellationToken.None);
        var pending = await Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza, 1, null, null, AddOn(cheese))), CancellationToken.None);

        (await LoadOrder(completed.Id)).OrderItems.Single(i => i.ParentOrderItemId != null).Price.ShouldBe(5m);
        completed.TotalAmount.ShouldBe(105m);
        // Pending keeps no snapshot but the total still honours the override.
        (await LoadOrder(pending.Id)).OrderItems.Single(i => i.ParentOrderItemId != null).Price.ShouldBeNull();
        pending.TotalAmount.ShouldBe(105m);
    }

    [Fact]
    public async Task Handle_InactiveAddOnPriceOverride_FallsBackToProductPrice()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var cheese = await SeedProduct("Cheese", 20m, isAddOn: true);
        await Link(pizza, cheese, overridePrice: 5m, overrideActive: false);

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Completed, Line(pizza, 1, null, null, AddOn(cheese))), CancellationToken.None);

        (await LoadOrder(dto.Id)).OrderItems.Single(i => i.ParentOrderItemId != null).Price.ShouldBe(20m);
        dto.TotalAmount.ShouldBe(120m);
    }

    [Fact]
    public async Task Handle_AddOnNotLinkedToProduct_Throws()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var cheese = await SeedProduct("Cheese", 20m, isAddOn: true);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza, 1, null, null, AddOn(cheese))), CancellationToken.None));

        ex.Message.ShouldContain("not allowed for this product");
        await AssertNothingSaved();
    }

    [Fact]
    public async Task Handle_InactiveAddOnLink_Throws()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var cheese = await SeedProduct("Cheese", 20m, isAddOn: true);
        await Link(pizza, cheese, active: false);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza, 1, null, null, AddOn(cheese))), CancellationToken.None));
        await AssertNothingSaved();
    }

    [Fact]
    public async Task Handle_NestedAddOns_Throws()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var cheese = await SeedProduct("Cheese", 20m, isAddOn: true);
        var bacon = await SeedProduct("Bacon", 25m, isAddOn: true);
        await Link(pizza, cheese);
        var nested = new OrderItemRequestDto(cheese, 1, [AddOn(bacon)], null, null);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza, 1, null, null, nested)), CancellationToken.None));

        ex.Message.ShouldContain("Nested add-ons");
        await AssertNothingSaved();
    }

    [Fact]
    public async Task Handle_SizeRequiredButNoAddOns_Throws()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var large = await SeedProduct("Large", 30m, isAddOn: true);
        await Link(pizza, large, AddOnTypeEnum.Size);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza)), CancellationToken.None));

        ex.Message.ShouldContain("size");
    }

    [Fact]
    public async Task Handle_FlavorRequiredButNoAddOns_Throws()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var spicy = await SeedProduct("Spicy", 0m, isAddOn: true);
        await Link(pizza, spicy, AddOnTypeEnum.Flavor);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza)), CancellationToken.None));

        ex.Message.ShouldContain("flavor");
    }

    [Fact]
    public async Task Handle_TwoSizes_Throws()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var small = await SeedProduct("Small", 0m, isAddOn: true);
        var large = await SeedProduct("Large", 30m, isAddOn: true);
        await Link(pizza, small, AddOnTypeEnum.Size);
        await Link(pizza, large, AddOnTypeEnum.Size);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza, 1, null, null, AddOn(small), AddOn(large))), CancellationToken.None));

        ex.Message.ShouldContain("size");
    }

    [Fact]
    public async Task Handle_SizeRequiredAndOtherAddOnOnly_Throws()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var large = await SeedProduct("Large", 30m, isAddOn: true);
        var cheese = await SeedProduct("Cheese", 20m, isAddOn: true);
        await Link(pizza, large, AddOnTypeEnum.Size);
        await Link(pizza, cheese, AddOnTypeEnum.Extra);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza, 1, null, null, AddOn(cheese))), CancellationToken.None));
    }

    [Fact]
    public async Task Handle_ExactlyOneSizeAndOneFlavor_Succeeds()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var large = await SeedProduct("Large", 30m, isAddOn: true);
        var spicy = await SeedProduct("Spicy", 5m, isAddOn: true);
        await Link(pizza, large, AddOnTypeEnum.Size);
        await Link(pizza, spicy, AddOnTypeEnum.Flavor);

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza, 1, null, null, AddOn(large), AddOn(spicy))), CancellationToken.None);

        dto.TotalAmount.ShouldBe(135m);
    }

    [Fact]
    public async Task Handle_TwoFlavors_Throws()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var f1 = await SeedProduct("F1", 0m, isAddOn: true);
        var f2 = await SeedProduct("F2", 0m, isAddOn: true);
        await Link(pizza, f1, AddOnTypeEnum.Flavor);
        await Link(pizza, f2, AddOnTypeEnum.Flavor);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza, 1, null, null, AddOn(f1), AddOn(f2))), CancellationToken.None));

        ex.Message.ShouldContain("flavor");
    }

    [Fact]
    public async Task Handle_SauceIsOptionalButAtMostOne()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var s1 = await SeedProduct("S1", 5m, isAddOn: true);
        var s2 = await SeedProduct("S2", 5m, isAddOn: true);
        await Link(pizza, s1, AddOnTypeEnum.Sauce);
        await Link(pizza, s2, AddOnTypeEnum.Sauce);

        (await Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza)), CancellationToken.None)).TotalAmount.ShouldBe(100m);
        (await Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza, 1, null, null, AddOn(s1))), CancellationToken.None)).TotalAmount.ShouldBe(105m);
        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza, 1, null, null, AddOn(s1), AddOn(s2))), CancellationToken.None));
        ex.Message.ShouldContain("sauce");
    }

    [Fact]
    public async Task Handle_AddOnLinkWithoutType_IsTreatedAsExtra()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var cheese = await SeedProduct("Cheese", 20m, isAddOn: true);
        await Link(pizza, cheese, type: null);

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza, 1, null, null, AddOn(cheese))), CancellationToken.None);

        dto.TotalAmount.ShouldBe(120m);
    }

    // ---------- products ----------

    [Fact]
    public async Task Handle_InactiveProduct_ThrowsNamingTheProduct()
    {
        var pizza = await SeedProduct("Pizza", 100m, active: false);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza)), CancellationToken.None));

        ex.Message.ShouldContain("inactive");
        ex.Message.ShouldContain("Pizza");
        await AssertNothingSaved();
    }

    [Fact]
    public async Task Handle_InactiveAddOnProduct_Throws()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var cheese = await SeedProduct("Cheese", 20m, active: false, isAddOn: true);
        await Link(pizza, cheese);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza, 1, null, null, AddOn(cheese))), CancellationToken.None));

        ex.Message.ShouldContain("Cheese");
        await AssertNothingSaved();
    }

    [Fact]
    public async Task Handle_MissingProduct_Throws()
    {
        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(Guid.NewGuid())), CancellationToken.None));

        ex.Message.ShouldContain("not found");
        await AssertNothingSaved();
    }

    [Fact]
    public async Task Handle_SameProductOnTwoLines_CreatesTwoParentRows()
    {
        var pizza = await SeedProduct("Pizza", 100m);

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza, 1), Line(pizza, 3)), CancellationToken.None);

        dto.Items.Count.ShouldBe(2);
        dto.TotalAmount.ShouldBe(400m);
    }

    // ---------- bundles ----------

    [Fact]
    public async Task Handle_FixedBundle_SavesBundleRowAndCountsBundlePriceOnly()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var drink = await SeedProduct("Drink", 40m);
        var bundle = await SeedBundle(120m, name: "Combo");
        var cmd = Cmd(OrderStatusEnum.Pending, Line(pizza, 1, bundle), Line(drink, 1, bundle), Line(drink)) with
        {
            BundlePromotions = [new OrderBundlePromotionRequestDto(bundle, 2)]
        };

        var dto = await Handler().Handle(cmd, CancellationToken.None);

        var saved = await LoadOrder(dto.Id);
        var row = saved.OrderBundlePromotions.Single();
        row.PromotionId.ShouldBe(bundle);
        row.Quantity.ShouldBe(2);
        row.UnitPrice.ShouldBe(120m);
        saved.OrderItems.Count(i => i.BundlePromotionId == bundle).ShouldBe(2);
        dto.BundlePromotions!.Single().ShouldBe(new OrderBundlePromotionDto(bundle, "Combo", 2, 120m));
        // 2 bundles * 120 + the stand-alone drink (40); bundled lines are not priced individually.
        dto.TotalAmount.ShouldBe(280m);
    }

    [Fact]
    public async Task Handle_MixMatchBundle_UsesMixMatchPrice()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var bundle = await SeedBundle(150m, mixMatch: true);
        var cmd = Cmd(OrderStatusEnum.Completed, Line(pizza, 2, bundle)) with
        {
            BundlePromotions = [new OrderBundlePromotionRequestDto(bundle, 1)]
        };

        var dto = await Handler().Handle(cmd, CancellationToken.None);

        dto.BundlePromotions!.Single().UnitPrice.ShouldBe(150m);
        dto.TotalAmount.ShouldBe(150m);
    }

    [Fact]
    public async Task Handle_BundleLineAddOns_InheritBundlePromotionId()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var cheese = await SeedProduct("Cheese", 20m, isAddOn: true);
        await Link(pizza, cheese);
        var bundle = await SeedBundle(120m);
        var cmd = Cmd(OrderStatusEnum.Pending, Line(pizza, 1, bundle, null, AddOn(cheese))) with
        {
            BundlePromotions = [new OrderBundlePromotionRequestDto(bundle, 1)]
        };

        var dto = await Handler().Handle(cmd, CancellationToken.None);

        (await LoadOrder(dto.Id)).OrderItems.ShouldAllBe(i => i.BundlePromotionId == bundle);
        dto.TotalAmount.ShouldBe(120m);
    }

    [Fact]
    public async Task Handle_DuplicateBundlePromotions_Throws()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var bundle = await SeedBundle(120m);
        var cmd = Cmd(OrderStatusEnum.Pending, Line(pizza)) with
        {
            BundlePromotions = [new OrderBundlePromotionRequestDto(bundle, 1), new OrderBundlePromotionRequestDto(bundle, 1)]
        };

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(cmd, CancellationToken.None));

        ex.Message.ShouldContain("Duplicate bundle");
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public async Task Handle_BundleQuantityNotPositive_Throws(int quantity)
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var bundle = await SeedBundle(120m);
        var cmd = Cmd(OrderStatusEnum.Pending, Line(pizza)) with
        {
            BundlePromotions = [new OrderBundlePromotionRequestDto(bundle, quantity)]
        };

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(cmd, CancellationToken.None));

        ex.Message.ShouldContain("greater than zero");
        await AssertNothingSaved();
    }

    [Fact]
    public async Task Handle_LineReferencesUnrequestedBundle_Throws()
    {
        var pizza = await SeedProduct("Pizza", 100m);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza, 1, Guid.NewGuid())), CancellationToken.None));

        ex.Message.ShouldContain("unknown bundle");
    }

    [Fact]
    public async Task Handle_PromotionThatIsNotABundleType_Throws()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var discountPromo = await SeedDiscount(pizza, 10m, null);
        var cmd = Cmd(OrderStatusEnum.Pending, Line(pizza)) with
        {
            BundlePromotions = [new OrderBundlePromotionRequestDto(discountPromo, 1)]
        };

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(cmd, CancellationToken.None));

        ex.Message.ShouldContain("invalid");
    }

    [Fact]
    public async Task Handle_UnknownBundlePromotion_Throws()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var cmd = Cmd(OrderStatusEnum.Pending, Line(pizza)) with
        {
            BundlePromotions = [new OrderBundlePromotionRequestDto(Guid.NewGuid(), 1)]
        };

        await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(cmd, CancellationToken.None));
        await AssertNothingSaved();
    }

    [Fact]
    public async Task Handle_InactiveBundlePromotion_ThrowsNamingPromotion()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var bundle = await SeedBundle(120m, active: false, name: "Old Combo");
        var cmd = Cmd(OrderStatusEnum.Pending, Line(pizza, 1, bundle)) with
        {
            BundlePromotions = [new OrderBundlePromotionRequestDto(bundle, 1)]
        };

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(cmd, CancellationToken.None));

        ex.Message.ShouldContain("Old Combo");
    }

    [Fact]
    public async Task Handle_BundleExpired_Throws()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var bundle = await SeedBundle(120m, end: Now.AddDays(-2));
        var cmd = Cmd(OrderStatusEnum.Pending, Line(pizza, 1, bundle)) with
        {
            BundlePromotions = [new OrderBundlePromotionRequestDto(bundle, 1)],
            CreatedAt = Now
        };

        await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(cmd, CancellationToken.None));
    }

    [Fact]
    public async Task Handle_BundleNotStartedYet_Throws()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var bundle = await SeedBundle(120m, start: Now.AddDays(2));
        var cmd = Cmd(OrderStatusEnum.Pending, Line(pizza, 1, bundle)) with
        {
            BundlePromotions = [new OrderBundlePromotionRequestDto(bundle, 1)],
            CreatedAt = Now
        };

        await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(cmd, CancellationToken.None));
    }

    [Fact]
    public async Task Handle_BundleStartingTodayLocally_IsActiveInThatTimeZone()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        // Starts 10 Jun 16:00 UTC = 11 Jun 00:00 in Manila. An order at 10 Jun 17:00 UTC is 11 Jun 01:00 locally.
        var bundle = await SeedBundle(120m, start: new DateTime(2026, 6, 10, 16, 0, 0, DateTimeKind.Utc));
        var cmd = Cmd(OrderStatusEnum.Pending, Line(pizza, 1, bundle)) with
        {
            BundlePromotions = [new OrderBundlePromotionRequestDto(bundle, 1)],
            CreatedAt = new DateTime(2026, 6, 10, 17, 0, 0, DateTimeKind.Utc)
        };

        var dto = await Handler("Asia/Manila").Handle(cmd, CancellationToken.None);

        dto.TotalAmount.ShouldBe(120m);
    }

    [Fact]
    public async Task Handle_BundleEndedLocallyButNotInUtc_ThrowsOnlyWithTimeZoneHeader()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var bundle = await SeedBundle(120m, end: new DateTime(2026, 6, 10, 10, 0, 0, DateTimeKind.Utc));
        var cmd = Cmd(OrderStatusEnum.Pending, Line(pizza, 1, bundle)) with
        {
            BundlePromotions = [new OrderBundlePromotionRequestDto(bundle, 1)],
            CreatedAt = new DateTime(2026, 6, 10, 20, 0, 0, DateTimeKind.Utc)
        };

        (await Handler().Handle(cmd, CancellationToken.None)).TotalAmount.ShouldBe(120m);
        await Should.ThrowAsync<InvalidOperationException>(() => Handler("Asia/Manila").Handle(cmd, CancellationToken.None));
    }

    [Fact]
    public async Task Handle_NegativeBundlePrice_Throws()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var bundle = await SeedBundle(-5m);
        var cmd = Cmd(OrderStatusEnum.Pending, Line(pizza, 1, bundle)) with
        {
            BundlePromotions = [new OrderBundlePromotionRequestDto(bundle, 1)]
        };

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(cmd, CancellationToken.None));

        ex.Message.ShouldContain("negative");
    }

    // ---------- notifications / audit ----------

    [Fact]
    public async Task Handle_Success_WritesAuditEntryWithOrderDetails()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var customer = await SeedCustomer();

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza, 2)) with { CustomerId = customer }, CancellationToken.None);

        await _audit.Received(1).LogAsync(
            AuditAction.OrderCreated,
            AuditEntityType.Order,
            dto.Id.ToString(),
            Arg.Any<object?>(),
            Arg.Is<object?>(v => v != null
                && (int)v.GetType().GetProperty("StatusId")!.GetValue(v)! == (int)OrderStatusEnum.Pending
                && (int)v.GetType().GetProperty("ItemCount")!.GetValue(v)! == 1
                && (decimal)v.GetType().GetProperty("totalAmount")!.GetValue(v)! == 200m
                && (Guid?)v.GetType().GetProperty("CustomerId")!.GetValue(v) == customer),
            _userId,
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_Success_SendsPushNotificationWithTotal()
    {
        var pizza = await SeedProduct("Pizza", 100m);

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza, 2)), CancellationToken.None);

        await _push.Received(1).SendOrderCreatedAsync(
            Arg.Is<Order>(o => o.Id == dto.Id), 200m, _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_Success_NotifiesDashboardViewers()
    {
        var pizza = await SeedProduct("Pizza", 100m);

        var dto = await Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza)), CancellationToken.None);

        var group = _hub.Clients.Group(HubNames.Groups.DashboardViewers);
        await group.Received(1).SendCoreAsync(HubNames.Events.DashboardUpdated, Arg.Any<object?[]>(), Arg.Any<CancellationToken>());
        await group.Received(1).SendCoreAsync(
            HubNames.Events.OrderUpdated,
            Arg.Is<object?[]>(args => args.Length == 1 && (Guid)args[0]! == dto.Id),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_ValidationFailure_DoesNotAuditPushOrBroadcast()
    {
        var pizza = await SeedProduct("Pizza", 100m, active: false);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza)), CancellationToken.None));

        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
        await _push.DidNotReceiveWithAnyArgs().SendOrderCreatedAsync(default!, default, default, default);
        await _hub.Clients.Group(HubNames.Groups.DashboardViewers).DidNotReceiveWithAnyArgs().SendCoreAsync(default!, default!, default);
    }

    // ---------- known gaps / bugs ----------

    [Fact]
    public async Task Handle_EmptyOrder_Throws()
    {
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(OrderStatusEnum.Pending), CancellationToken.None));
        await AssertNothingSaved();
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-2)]
    public async Task Handle_NonPositiveQuantity_Throws(int quantity)
    {
        var pizza = await SeedProduct("Pizza", 100m);
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza, quantity)), CancellationToken.None));
        await AssertNothingSaved();
    }

    [Theory]
    [InlineData("special", "Special instructions cannot be longer than 100 characters.")]
    [InlineData("note", "Note cannot be longer than 500 characters.")]
    [InlineData("item", "Item special instructions cannot be longer than 100 characters.")]
    public async Task Handle_TooLongText_IsRejectedWithAClearMessageAndSavesNothing(string field, string message)
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var cmd = field switch
        {
            "special" => Cmd(OrderStatusEnum.Pending, Line(pizza)) with { SpecialInstructions = new string('a', 101) },
            "note" => Cmd(OrderStatusEnum.Pending, Line(pizza)) with { Note = new string('a', 501) },
            _ => Cmd(OrderStatusEnum.Pending, Line(pizza, note: new string('a', 101))),
        };

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(cmd, CancellationToken.None));

        ex.Message.ShouldBe(message);
        await AssertNothingSaved();
    }

    [Fact]
    public async Task Handle_WalkInOrderWithoutACustomer_IsSavedWithNoCustomer()
    {
        var pizza = await SeedProduct("Pizza", 100m);

        var dto = await Handler().Handle(
            Cmd(OrderStatusEnum.Pending, Line(pizza)) with { CustomerId = null }, CancellationToken.None);

        dto.CustomerId.ShouldBeNull();
        await using var db = TestDb.Create(_dbName);
        (await db.Orders.SingleAsync()).CustomerId.ShouldBeNull();
    }

    // A walk-in (no customer) is valid: Order.CustomerId is nullable and the POS sends null for walk-ins.
    // A non-null id must belong to an existing, active customer.
    [Fact]
    public async Task Handle_UnknownCustomer_IsRejectedAndNothingIsSaved()
    {
        var pizza = await SeedProduct("Pizza", 100m);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza)) with { CustomerId = Guid.NewGuid() }, CancellationToken.None));

        ex.Message.ShouldBe("Customer does not exist.");
        await using var db = TestDb.Create(_dbName);
        (await db.Orders.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Handle_InactiveCustomer_IsRejectedAndNothingIsSaved()
    {
        var pizza = await SeedProduct("Pizza", 100m);
        var customer = await SeedCustomer(active: false);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Cmd(OrderStatusEnum.Pending, Line(pizza)) with { CustomerId = customer }, CancellationToken.None));

        ex.Message.ShouldBe("Customer is inactive.");
        await using var db = TestDb.Create(_dbName);
        (await db.Orders.CountAsync()).ShouldBe(0);
    }

    // Order numbers (the SQL sequence) and rollback after a mid-way failure are covered against a real SQL Server in
    // Database/CreateOrderDatabaseTests.cs.
}
