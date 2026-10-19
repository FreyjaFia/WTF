using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.OrderLinks;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Products.Enums;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.OrderLinks;

public class SubmitPublicOrderHandlerTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _staffId = Guid.NewGuid();
    private readonly Guid _systemUserId = Guid.NewGuid();
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly IPushNotificationService _push = TestFakes.Push();

    private Customer _customer = null!;
    private ShortLink _link = null!;
    private Product _latte = null!;
    private Product _croissant = null!;

    public SubmitPublicOrderHandlerTests()
    {
        _customer = new Customer
        {
            Id = Guid.NewGuid(),
            FirstName = "Maria",
            LastName = "Cruz",
            IsActive = true,
            AllowOrderingLink = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = _staffId
        };
        _link = new ShortLink
        {
            Id = Guid.NewGuid(),
            Token = OrderLinkToken.Generate(),
            TargetType = "CustomerOrder",
            TargetId = _customer.Id,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = _staffId
        };
        _latte = NewProduct("Latte", 150);
        _croissant = NewProduct("Croissant", 120);
        TestDb.SaveAsync(_db, _customer, _link, _latte, _croissant, NewSystemUser(_systemUserId)).GetAwaiter().GetResult();
    }

    // --- seeding ---

    private static User NewSystemUser(Guid id) => new()
    {
        Id = id,
        Username = SubmitPublicOrderHandler.SystemUsername,
        PasswordHash = "!",
        FirstName = "Customer",
        LastName = "Link",
        IsActive = false,
        RoleId = 2,
        CreatedAt = DateTime.UtcNow,
        CreatedBy = id
    };

    private Product NewProduct(string name, decimal price, bool addOn = false, bool active = true) => new()
    {
        Id = Guid.NewGuid(),
        Name = name,
        Code = name.ToUpperInvariant(),
        Price = price,
        CategoryId = 1,
        IsActive = active,
        IsAddOn = addOn,
        CreatedAt = DateTime.UtcNow,
        CreatedBy = _staffId
    };

    private async Task<Product> AddAddOnAsync(Product parent, string name, decimal price,
        AddOnTypeEnum type = AddOnTypeEnum.Extra, decimal? overridePrice = null)
    {
        var addOn = NewProduct(name, price, addOn: true);
        await TestDb.SaveAsync(_db, addOn,
            new ProductAddOn { ProductId = parent.Id, AddOnId = addOn.Id, AddOnTypeId = (int)type, IsActive = true });
        if (overridePrice.HasValue)
        {
            await TestDb.SaveAsync(_db, new ProductAddOnPriceOverride
            {
                Id = Guid.NewGuid(),
                ProductId = parent.Id,
                AddOnId = addOn.Id,
                Price = overridePrice.Value,
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            });
        }

        return addOn;
    }

    private async Task AddWaitingOrdersAsync(Guid customerId, int count, OrderStatusEnum status = OrderStatusEnum.PendingApproval,
        OrderSourceEnum source = OrderSourceEnum.CustomerLink)
    {
        for (var i = 0; i < count; i++)
        {
            await TestDb.SaveAsync(_db, new Order
            {
                Id = Guid.NewGuid(),
                OrderNumber = Random.Shared.Next(1, 1_000_000),
                CustomerId = customerId,
                StatusId = (int)status,
                Source = (byte)source,
                CreatedAt = DateTime.UtcNow,
                CreatedBy = _staffId
            });
        }
    }

    // --- the handler under test, wired to the real create-order handler ---

    private ISender RealSender()
    {
        var sender = Substitute.For<ISender>();
        sender.Send(Arg.Any<IRequest<OrderDto>>(), Arg.Any<CancellationToken>())
            .Returns(call => new CreateOrderHandler(
                    TestDb.Create(_db), TestRequest.None(), TestFakes.Hub(), _audit, _push, TestFakes.Conversations())
                .Handle((CreateOrderCommand)call.Arg<IRequest<OrderDto>>(), call.Arg<CancellationToken>()));
        return sender;
    }

    /// <summary>A clock that answers each call with the next time in the list (and the last one from then on).</summary>
    private sealed class SteppingTimeProvider(params DateTimeOffset[] times) : TimeProvider
    {
        private int _next;

        public int Calls => _next;

        public override DateTimeOffset GetUtcNow() => times[Math.Min(_next++, times.Length - 1)];
    }

    private Task<WTF.Api.Features.OrderLinks.DTOs.PublicOrderDto?> Submit(
        SubmitPublicOrderRequest request, string? token = null, TimeProvider? clock = null, ISender? sender = null) =>
        new SubmitPublicOrderHandler(
                TestDb.Create(_db), sender ?? RealSender(), NullLogger<SubmitPublicOrderHandler>.Instance,
                clock ?? TimeProvider.System)
            .Handle(new SubmitPublicOrderCommand(token ?? _link.Token, request), CancellationToken.None);

    private SubmitPublicOrderRequest Request(
        List<PublicOrderItemRequest>? items = null,
        FulfillmentTypeEnum fulfillment = FulfillmentTypeEnum.Pickup,
        string? address = null,
        string? contact = "0917 123 4567",
        PaymentMethodEnum payment = PaymentMethodEnum.Cash,
        decimal? amount = 1000,
        string? instructions = null,
        decimal? tips = null) =>
        new(items ?? [new PublicOrderItemRequest(_latte.Id, 1, null, null)], fulfillment, address, contact, payment,
            amount, instructions, tips);

    private async Task AddDiscountAsync(Guid productId, decimal? amountOff, decimal? percent, Guid[]? addOns = null,
        bool active = true, int? maxRedemptions = null, int? maxPerOrder = null)
    {
        var promo = new Promotion
        {
            Id = Guid.NewGuid(),
            Name = "Disc",
            MaxPerOrder = maxPerOrder,
            TypeId = PromotionTypeIds.DiscountedProduct,
            IsActive = active,
            MaxRedemptions = maxRedemptions,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = _staffId
        };
        var rule = new DiscountedProductPromotion { Id = Guid.NewGuid(), PromotionId = promo.Id, ProductId = productId, FixedPrice = amountOff, PercentOff = percent };
        foreach (var addOn in addOns ?? [])
        {
            rule.DiscountedProductPromotionAddOns.Add(new DiscountedProductPromotionAddOn { Id = Guid.NewGuid(), DiscountedProductPromotionId = rule.Id, AddOnProductId = addOn, Quantity = 1 });
        }

        promo.DiscountedProductPromotions.Add(rule);
        await TestDb.SaveAsync(_db, promo);
    }

    private List<PublicOrderItemRequest> Items(Product product, int qty = 1, params Product[] addOns) =>
        [new PublicOrderItemRequest(product.Id, qty, [.. addOns.Select(a => new PublicOrderAddOnRequest(a.Id, 1))], null)];

    [Fact]
    public async Task Discount_LowersTheTotalTheCashHasToCover()
    {
        await AddDiscountAsync(_croissant.Id, null, 10m);

        var accepted = await Submit(Request(Items(_croissant), amount: 108));

        accepted.ShouldNotBeNull();
        accepted.Total.ShouldBe(108m);
        await Should.ThrowAsync<InvalidOperationException>(() => Submit(Request(Items(_croissant), amount: 107.99m)));
    }

    [Fact]
    public async Task Discount_RefusalMessage_NamesTheDiscountedTotal()
    {
        await AddDiscountAsync(_croissant.Id, null, 10m);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Submit(Request(Items(_croissant), amount: 50)));

        ex.Message.ShouldContain("108.00");
    }

    [Fact]
    public async Task Discount_ThatNeedsAnAddOn_OnlyAppliesWithExactlyThatAddOn()
    {
        var size = await AddAddOnAsync(_latte, "Small", 0, AddOnTypeEnum.Size);
        var shot = await AddAddOnAsync(_latte, "Shot", 25);
        await AddDiscountAsync(_latte.Id, 40m, null, [size.Id]);

        var matching = await Submit(Request(Items(_latte, 1, size)));
        var extra = await Submit(Request(Items(_latte, 1, size, shot)));

        matching!.Total.ShouldBe(110m);
        extra!.Total.ShouldBe(175m);
    }

    [Fact]
    public async Task PlainProductDiscount_DoesNotApplyToTheProductWithAddOns()
    {
        var shot = await AddAddOnAsync(_croissant, "Shot", 25);
        await AddDiscountAsync(_croissant.Id, null, 50m);

        (await Submit(Request(Items(_croissant))))!.Total.ShouldBe(60m);
        (await Submit(Request(Items(_croissant, 1, shot))))!.Total.ShouldBe(145m);
    }

    [Fact]
    public async Task Discount_AmountOffAboveThePrice_MakesTheItemFreeButNotItsAddOns()
    {
        var shot = await AddAddOnAsync(_croissant, "Shot", 25);
        await AddDiscountAsync(_croissant.Id, 500m, null, [shot.Id]);

        var dto = await Submit(Request(Items(_croissant, 2, shot), amount: 50));

        dto!.Total.ShouldBe(50m);
    }

    [Fact]
    public async Task Discount_WithFewerUsesLeftThanTheQuantity_CoversOnlyTheUsesLeft()
    {
        await AddDiscountAsync(_croissant.Id, null, 50m, maxRedemptions: 1);

        (await Submit(Request(Items(_croissant, 2))))!.Total.ShouldBe(60m + 120m);
        // The first order is waiting and holds the only use.
        (await Submit(Request(Items(_croissant, 1))))!.Total.ShouldBe(120m);
    }

    [Fact]
    public async Task Discount_WithALimitPerOrder_ChargesTheRestFullPrice()
    {
        await AddDiscountAsync(_croissant.Id, null, 50m, maxPerOrder: 2);

        (await Submit(Request(Items(_croissant, 5), amount: 1000)))!.Total.ShouldBe(2 * 60m + 3 * 120m);
    }

    [Fact]
    public async Task Discount_WithALimitPerOrder_ARefusalExplainsTheLimit()
    {
        await AddDiscountAsync(_croissant.Id, null, 50m, maxPerOrder: 2);

        var ex = await Should.ThrowAsync<InvalidOperationException>(
            () => Submit(Request(Items(_croissant, 5), amount: 1000) with { ExpectedTotal = 5 * 60m }));

        ex.Message.ShouldContain("limit 2 per order");
        ex.Message.ShouldContain("480.00");
    }

    [Fact]
    public async Task InactiveDiscount_IsIgnored()
    {
        await AddDiscountAsync(_croissant.Id, null, 50m, active: false);

        (await Submit(Request(Items(_croissant))))!.Total.ShouldBe(120m);
    }

    [Fact]
    public async Task Discount_WithATip_CashMustCoverTheDiscountedTotalPlusTheTip()
    {
        await AddDiscountAsync(_croissant.Id, null, 10m);

        await Should.ThrowAsync<InvalidOperationException>(() => Submit(Request(Items(_croissant), amount: 108, tips: 10)));
        (await Submit(Request(Items(_croissant), amount: 118, tips: 10)))!.Total.ShouldBe(108m);
    }

    [Fact]
    public async Task Discount_ChangeSavedWithTheOrder_IsWorkedOutFromTheDiscountedTotal()
    {
        await AddDiscountAsync(_croissant.Id, null, 10m);

        var dto = await Submit(Request(Items(_croissant, 2), amount: 1000, tips: 4));

        dto!.Total.ShouldBe(216m);
        await using var db = TestDb.Create(_db);
        var saved = await db.Orders.SingleAsync(o => o.Id == dto.Id);
        saved.ChangeAmount.ShouldBe(1000m - 216m - 4m);
    }

    [Fact]
    public async Task ExpectedTotal_MatchingTheServersTotal_PlacesTheOrder()
    {
        await AddDiscountAsync(_croissant.Id, null, 10m);

        var dto = await Submit(Request(Items(_croissant, 2), amount: 300) with { ExpectedTotal = 216m });

        dto!.Total.ShouldBe(216m);
    }

    [Fact]
    public async Task ExpectedTotal_FromAnOlderPage_IsOptional()
    {
        (await Submit(Request(Items(_croissant), amount: 300)))!.Total.ShouldBe(120m);
    }

    [Theory]
    [InlineData(108.0)]
    [InlineData(119.99)]
    [InlineData(120.01)]
    public async Task ExpectedTotal_ThatDiffers_RefusesTheOrderAndCreatesNothing(double expected)
    {
        // The page showed a discount that has run out since: the shop asks the customer to look again.
        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Submit(Request(Items(_croissant), amount: 500) with { ExpectedTotal = (decimal)expected }));

        ex.Message.ShouldContain("The total changed to PHP 120.00");
        (await OrderCountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task ADiscountThatRanOutBetweenCartAndPlaceOrder_IsRefusedInsteadOfChargedFullPrice()
    {
        await AddDiscountAsync(_croissant.Id, null, 10m, maxRedemptions: 1);
        var waiting = await Submit(Request(Items(_croissant), amount: 108) with { ExpectedTotal = 108m });
        waiting!.Total.ShouldBe(108m);

        // A second customer's page still shows 108: the first order holds the only use.
        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Submit(Request(Items(_croissant), amount: 200) with { ExpectedTotal = 108m }));

        ex.Message.ShouldContain("PHP 120.00");
    }

    [Fact]
    public async Task AWaitingOrder_HoldsItsDiscountUseUntilItIsRejected()
    {
        await AddDiscountAsync(_croissant.Id, null, 10m, maxRedemptions: 1);
        var first = await Submit(Request(Items(_croissant), amount: 108));
        (await Submit(Request(Items(_croissant), amount: 120)))!.Total.ShouldBe(120m);

        await using (var db = TestDb.Create(_db))
        {
            db.Orders.Single(o => o.Id == first!.Id).StatusId = (int)OrderStatusEnum.Cancelled;
            await db.SaveChangesAsync();
        }

        (await Submit(Request(Items(_croissant), amount: 108)))!.Total.ShouldBe(108m);
    }

    private async Task<int> OrderCountAsync()



    {
        await using var db = TestDb.Create(_db);
        return await db.Orders.CountAsync();
    }

    private async Task ShouldRejectAsync(SubmitPublicOrderRequest request, string messagePart)
    {
        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Submit(request));
        ex.Message.ToLowerInvariant().ShouldContain(messagePart.ToLowerInvariant());
        (await OrderCountAsync()).ShouldBe(0, "a rejected request must not leave an order behind");
    }

    // --- success ---

    [Fact]
    public async Task Submit_ValidOrder_CreatesAnOrderWaitingForApprovalOwnedByTheSystemUser()
    {
        var dto = await Submit(Request(
            fulfillment: FulfillmentTypeEnum.Delivery, address: "  5 Side St  ", contact: " 0917 123 4567 ",
            amount: 500, instructions: " No ice "));

        dto.ShouldNotBeNull();
        dto.StatusKind.ShouldBe("waiting");
        dto.StatusLabel.ShouldBe("Waiting for confirmation");
        dto.Total.ShouldBe(150);
        dto.FulfillmentType.ShouldBe("Delivery");

        await using var db = TestDb.Create(_db);
        var order = await db.Orders.SingleAsync();
        order.StatusId.ShouldBe((int)OrderStatusEnum.PendingApproval);
        order.Source.ShouldBe((byte)OrderSourceEnum.CustomerLink);
        order.OrderLinkId.ShouldBe(_link.Id);
        order.CustomerId.ShouldBe(_customer.Id);
        order.CreatedBy.ShouldBe(_systemUserId);
        order.FulfillmentType.ShouldBe((byte)FulfillmentTypeEnum.Delivery);
        order.DeliveryAddress.ShouldBe("5 Side St");
        order.ContactNumber.ShouldBe("0917 123 4567");
        order.PaymentMethodId.ShouldBe((int)PaymentMethodEnum.Cash);
        order.AmountReceived.ShouldBe(500);
        order.ChangeAmount.ShouldBe(350);
        order.SpecialInstructions.ShouldBe("No ice");
        order.Tips.ShouldBeNull();
    }

    [Fact]
    public async Task Submit_StoresItemsWithAddOnQuantitiesAndSpecialInstructions()
    {
        var shot = await AddAddOnAsync(_latte, "Extra shot", 40);
        var dto = await Submit(Request(
            [new PublicOrderItemRequest(_latte.Id, 2, [new PublicOrderAddOnRequest(shot.Id, 3)], " less ice ")],
            amount: 2000));

        dto!.Items.Count.ShouldBe(1);
        dto.Items[0].Quantity.ShouldBe(2);
        dto.Items[0].SpecialInstructions.ShouldBe("less ice");
        dto.Items[0].AddOns.ShouldHaveSingleItem().Quantity.ShouldBe(3);
        dto.Total.ShouldBe((150 + 40 * 3) * 2);

        await using var db = TestDb.Create(_db);
        var items = await db.OrderItems.ToListAsync();
        items.Count.ShouldBe(2);
        items.Single(i => i.ParentOrderItemId == null).Price.ShouldBeNull("waiting orders store no prices");
        items.Single(i => i.ParentOrderItemId != null).Quantity.ShouldBe(3);
    }

    [Fact]
    public async Task Submit_AddOnPriceUsesThePriceSetForThatProduct()
    {
        var shot = await AddAddOnAsync(_latte, "Extra shot", 40, overridePrice: 25);

        var dto = await Submit(Request(
            [new PublicOrderItemRequest(_latte.Id, 1, [new PublicOrderAddOnRequest(shot.Id, 2)], null)], amount: 200));

        dto!.Total.ShouldBe(150 + 25 * 2);
        dto.Items[0].AddOns[0].UnitPrice.ShouldBe(25);
    }

    [Fact]
    public async Task Submit_RepeatedAddOnsOnOneItemAreMergedIntoOne()
    {
        var shot = await AddAddOnAsync(_latte, "Extra shot", 40);

        var dto = await Submit(Request(
            [new PublicOrderItemRequest(_latte.Id, 1,
                [new PublicOrderAddOnRequest(shot.Id, 1), new PublicOrderAddOnRequest(shot.Id, 2)], null)],
            amount: 500));

        dto!.Items[0].AddOns.ShouldHaveSingleItem().Quantity.ShouldBe(3);
        dto.Total.ShouldBe(150 + 40 * 3);
    }

    [Fact]
    public async Task Submit_PickupIgnoresAnyAddressSent()
    {
        await Submit(Request(fulfillment: FulfillmentTypeEnum.Pickup, address: "somewhere"));

        await using var db = TestDb.Create(_db);
        (await db.Orders.SingleAsync()).DeliveryAddress.ShouldBeNull();
    }

    private Task<WTF.Api.Features.OrderLinks.DTOs.PublicOrderDto?> SubmitWithAudit(SubmitPublicOrderRequest request) =>
        new SubmitPublicOrderHandler(
                TestDb.Create(_db), RealSender(), NullLogger<SubmitPublicOrderHandler>.Instance,
                TimeProvider.System, null, _audit)
            .Handle(new SubmitPublicOrderCommand(_link.Token, request), CancellationToken.None);

    [Fact]
    public async Task Submit_SaveContactNumber_KeepsTheNumberOnTheCustomerAndAudits()
    {
        await SubmitWithAudit(Request(contact: "0999 888 7777") with { SaveContactNumber = true });

        await using var db = TestDb.Create(_db);
        var customer = await db.Customers.SingleAsync();
        customer.ContactNumber.ShouldBe("0999 888 7777");
        customer.UpdatedBy.ShouldBe(_systemUserId);
        await _audit.Received(1).LogAsync(
            AuditAction.CustomerUpdated, AuditEntityType.Customer, _customer.Id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _systemUserId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Submit_SaveAddress_KeepsTheDeliveryAddressOnTheCustomer()
    {
        await SubmitWithAudit(
            Request(fulfillment: FulfillmentTypeEnum.Delivery, address: "9 New St") with { SaveAddress = true });

        await using var db = TestDb.Create(_db);
        (await db.Customers.SingleAsync()).Address.ShouldBe("9 New St");
    }

    [Fact]
    public async Task Submit_SaveAddress_OnPickupHasNoAddressToKeep()
    {
        await SubmitWithAudit(
            Request(fulfillment: FulfillmentTypeEnum.Pickup, address: "9 New St") with { SaveAddress = true });

        await using var db = TestDb.Create(_db);
        (await db.Customers.SingleAsync()).Address.ShouldBeNull();
    }

    [Fact]
    public async Task Submit_WithoutTheSaveFlags_LeavesTheCustomerAlone()
    {
        await SubmitWithAudit(
            Request(fulfillment: FulfillmentTypeEnum.Delivery, address: "9 New St", contact: "0999 888 7777"));

        await using var db = TestDb.Create(_db);
        var customer = await db.Customers.SingleAsync();
        customer.ContactNumber.ShouldBeNull();
        customer.Address.ShouldBeNull();
        await _audit.DidNotReceive().LogAsync(
            AuditAction.CustomerUpdated, Arg.Any<AuditEntityType>(), Arg.Any<string>(),
            Arg.Any<object?>(), Arg.Any<object?>(), Arg.Any<Guid?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Submit_SaveContactNumber_WhenUnchanged_WritesNoAuditEntry()
    {
        await using (var db = TestDb.Create(_db))
        {
            (await db.Customers.SingleAsync()).ContactNumber = "0917 123 4567";
            await db.SaveChangesAsync();
        }

        await SubmitWithAudit(Request(contact: "0917 123 4567") with { SaveContactNumber = true });

        await _audit.DidNotReceive().LogAsync(
            AuditAction.CustomerUpdated, Arg.Any<AuditEntityType>(), Arg.Any<string>(),
            Arg.Any<object?>(), Arg.Any<object?>(), Arg.Any<Guid?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Submit_AuditsTheOrderAsCreatedBySystemUserAndAlertsStaff()
    {
        await Submit(Request());

        await _audit.Received(1).LogAsync(
            AuditAction.OrderCreated, AuditEntityType.Order, Arg.Any<string>(),
            Arg.Any<object?>(), Arg.Any<object?>(), _systemUserId, Arg.Any<CancellationToken>());
        await _push.Received(1).SendLinkOrderCreatedAsync(
            Arg.Is<Order>(o => o.StatusId == (int)OrderStatusEnum.PendingApproval),
            150m, "Maria Cruz", FulfillmentTypeEnum.Pickup, Arg.Any<CancellationToken>());
        await _push.DidNotReceiveWithAnyArgs().SendOrderCreatedAsync(default!, default, default, default);
    }

    [Fact]
    public async Task Submit_SeveralOrdersOnOneLinkAreAllowed()
    {
        await Submit(Request());
        await Submit(Request());

        (await OrderCountAsync()).ShouldBe(2);
    }

    // --- the link ---

    [Fact]
    public async Task Submit_UnknownRevokedExpiredOrDisabledLink_ReturnsNullAndCreatesNothing()
    {
        await using (var db = TestDb.Create(_db))
        {
            db.ShortLinks.Add(new ShortLink
            {
                Id = Guid.NewGuid(),
                Token = "revoked-token",
                TargetType = "CustomerOrder",
                TargetId = _customer.Id,
                RevokedAt = DateTime.UtcNow.AddMinutes(-1),
                CreatedAt = DateTime.UtcNow
            });
            db.ShortLinks.Add(new ShortLink
            {
                Id = Guid.NewGuid(),
                Token = "expired-token",
                TargetType = "CustomerOrder",
                TargetId = _customer.Id,
                ExpiresAt = DateTime.UtcNow.AddMinutes(-1),
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        (await Submit(Request(), "nope")).ShouldBeNull();
        (await Submit(Request(), "revoked-token")).ShouldBeNull();
        (await Submit(Request(), "expired-token")).ShouldBeNull();

        await using (var db = TestDb.Create(_db))
        {
            (await db.Customers.SingleAsync()).AllowOrderingLink = false;
            await db.SaveChangesAsync();
        }

        (await Submit(Request())).ShouldBeNull();
        (await OrderCountAsync()).ShouldBe(0);
    }

    // --- items ---

    [Fact]
    public async Task Submit_EmptyOrTooManyItems_IsRejected()
    {
        await ShouldRejectAsync(Request(items: []), "empty");

        var many = Enumerable.Range(0, SubmitPublicOrderHandler.MaxLines + 1)
            .Select(_ => new PublicOrderItemRequest(_latte.Id, 1, null, null)).ToList();
        await ShouldRejectAsync(Request(items: many), "at most");
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(100)]
    public async Task Submit_ItemQuantityOutsideOneToNinetyNine_IsRejected(int quantity)
    {
        await ShouldRejectAsync(Request([new PublicOrderItemRequest(_latte.Id, quantity, null, null)]), "between 1 and 99");
    }

    [Theory]
    [InlineData(0)]
    [InlineData(100)]
    public async Task Submit_AddOnQuantityOutsideOneToNinetyNine_IsRejected(int quantity)
    {
        var shot = await AddAddOnAsync(_latte, "Extra shot", 40);

        await ShouldRejectAsync(
            Request([new PublicOrderItemRequest(_latte.Id, 1, [new PublicOrderAddOnRequest(shot.Id, quantity)], null)]),
            "between 1 and 99");
    }

    [Fact]
    public async Task Submit_TooManyDifferentAddOns_IsRejected()
    {
        var addOns = new List<PublicOrderAddOnRequest>();
        for (var i = 0; i <= SubmitPublicOrderHandler.MaxAddOnsPerLine; i++)
        {
            addOns.Add(new PublicOrderAddOnRequest((await AddAddOnAsync(_latte, $"Add-on {i}", 1)).Id, 1));
        }

        await ShouldRejectAsync(Request([new PublicOrderItemRequest(_latte.Id, 1, addOns, null)]), "at most");
    }

    [Fact]
    public async Task Submit_AnItemAsItsOwnAddOn_IsRejected()
    {
        await ShouldRejectAsync(
            Request([new PublicOrderItemRequest(_latte.Id, 1, [new PublicOrderAddOnRequest(_latte.Id, 1)], null)]),
            "own add-on");
    }

    [Fact]
    public async Task Submit_OverLongItemInstructions_IsRejected()
    {
        await ShouldRejectAsync(
            Request([new PublicOrderItemRequest(_latte.Id, 1, null, new string('x', 101))]), "100 characters");
    }

    [Fact]
    public async Task Submit_OverLongOrderInstructions_IsRejected()
    {
        await ShouldRejectAsync(Request(instructions: new string('x', 101)), "100 characters");
    }

    [Fact]
    public async Task Submit_UnknownInactiveOrAddOnAsMainItem_SaysTheMenuChanged()
    {
        var retired = NewProduct("Retired", 50, active: false);
        var shot = NewProduct("Shot", 10, addOn: true);
        await TestDb.SaveAsync(_db, retired, shot);

        await ShouldRejectAsync(Request([new PublicOrderItemRequest(Guid.NewGuid(), 1, null, null)]), "no longer available");
        await ShouldRejectAsync(Request([new PublicOrderItemRequest(retired.Id, 1, null, null)]), "no longer available");
        await ShouldRejectAsync(Request([new PublicOrderItemRequest(shot.Id, 1, null, null)]), "no longer available");
    }

    [Fact]
    public async Task Submit_AnInactiveAddOn_SaysTheMenuChanged()
    {
        var shot = await AddAddOnAsync(_latte, "Extra shot", 40);
        await using (var db = TestDb.Create(_db))
        {
            (await db.Products.SingleAsync(p => p.Id == shot.Id)).IsActive = false;
            await db.SaveChangesAsync();
        }

        await ShouldRejectAsync(
            Request([new PublicOrderItemRequest(_latte.Id, 1, [new PublicOrderAddOnRequest(shot.Id, 1)], null)]),
            "no longer available");
    }

    [Fact]
    public async Task Submit_AnAddOnThatDoesNotBelongToTheProduct_IsRejectedByTheOrderRules()
    {
        var other = NewProduct("Other add-on", 5, addOn: true);
        await TestDb.SaveAsync(_db, other);

        await ShouldRejectAsync(
            Request([new PublicOrderItemRequest(_latte.Id, 1, [new PublicOrderAddOnRequest(other.Id, 1)], null)]),
            "not allowed for this product");
    }

    [Fact]
    public async Task Submit_AProductWithASizeNeedsExactlyOne()
    {
        var large = await AddAddOnAsync(_latte, "Large", 30, AddOnTypeEnum.Size);
        var regular = await AddAddOnAsync(_latte, "Regular", 0, AddOnTypeEnum.Size);

        await ShouldRejectAsync(Request([new PublicOrderItemRequest(_latte.Id, 1, null, null)]), "size");
        await ShouldRejectAsync(
            Request([new PublicOrderItemRequest(_latte.Id, 1,
                [new PublicOrderAddOnRequest(large.Id, 1), new PublicOrderAddOnRequest(regular.Id, 1)], null)]),
            "size");

        var ok = await Submit(Request(
            [new PublicOrderItemRequest(_latte.Id, 1, [new PublicOrderAddOnRequest(large.Id, 1)], null)], amount: 500));
        ok!.Total.ShouldBe(180);
    }

    // --- fulfillment and contact ---

    [Fact]
    public async Task Submit_DeliveryNeedsAnAddress()
    {
        await ShouldRejectAsync(Request(fulfillment: FulfillmentTypeEnum.Delivery, address: null), "delivery address");
        await ShouldRejectAsync(Request(fulfillment: FulfillmentTypeEnum.Delivery, address: "   "), "delivery address");
        await ShouldRejectAsync(
            Request(fulfillment: FulfillmentTypeEnum.Delivery, address: new string('a', 301)), "300 characters");
    }

    [Fact]
    public async Task Submit_FulfillmentMustBeOneOfTheTwo()
    {
        await ShouldRejectAsync(Request(fulfillment: (FulfillmentTypeEnum)9), "pickup or delivery");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Submit_AContactNumberIsRequired(string? contact)
    {
        await ShouldRejectAsync(Request(contact: contact), "contact number is required");
    }

    [Theory]
    [InlineData("call me")]
    [InlineData("12345")]
    [InlineData("0917-ABC-4567")]
    [InlineData("<script>")]
    public async Task Submit_AnInvalidContactNumber_IsRejected(string contact)
    {
        await ShouldRejectAsync(Request(contact: contact), "valid contact number");
    }

    [Fact]
    public async Task Submit_ContactNumberOverThirtyCharacters_IsRejected()
    {
        await ShouldRejectAsync(Request(contact: new string('1', 31)), "valid contact number");
    }

    [Theory]
    [InlineData("0917 123 4567")]
    [InlineData("+63 917 123 4567")]
    [InlineData("(02) 8123-4567")]
    public async Task Submit_CommonPhoneFormatsAreAccepted(string contact)
    {
        (await Submit(Request(contact: contact))).ShouldNotBeNull();
    }

    // --- payment ---

    [Fact]
    public async Task Submit_CashNeedsAnAmountThatCoversTheServerTotal()
    {
        await ShouldRejectAsync(Request(amount: null), "amount you will pay");
        await ShouldRejectAsync(Request(amount: 149.99m), "at least the order total");
        await ShouldRejectAsync(Request(amount: 0), "at least the order total");
        await ShouldRejectAsync(Request(amount: -5), "at least the order total");
    }

    [Fact]
    public async Task Submit_CashExactlyTheTotalLeavesNoChange_AndMoreLeavesChange()
    {
        await Submit(Request(amount: 150));
        await Submit(Request(amount: 200));

        await using var db = TestDb.Create(_db);
        var changes = await db.Orders.Select(o => o.ChangeAmount).ToListAsync();
        changes.Order().ShouldBe([0m, 50m]);
    }

    [Fact]
    public async Task Submit_TheTotalIsWorkedOutByTheServerNotTheCustomer()
    {
        // A customer who sends an amount that would cover a cheaper cart is still held to the real prices.
        await ShouldRejectAsync(
            Request([new PublicOrderItemRequest(_latte.Id, 3, null, null)], amount: 150), "at least the order total");
    }

    [Fact]
    public async Task Submit_AnAbsurdCashAmount_IsRejected()
    {
        await ShouldRejectAsync(Request(amount: SubmitPublicOrderHandler.MaxCashAmount + 1), "too large");
    }

    [Fact]
    public async Task Submit_GCashStoresNoCashAmount()
    {
        var dto = await Submit(Request(payment: PaymentMethodEnum.GCash, amount: 12345));

        dto!.PaymentMethod.ShouldBe("GCash");
        await using var db = TestDb.Create(_db);
        var order = await db.Orders.SingleAsync();
        order.PaymentMethodId.ShouldBe((int)PaymentMethodEnum.GCash);
        order.AmountReceived.ShouldBeNull();
        order.ChangeAmount.ShouldBeNull();
    }

    [Fact]
    public async Task Submit_PaymentMethodMustBeOneOfTheTwo()
    {
        await ShouldRejectAsync(Request(payment: (PaymentMethodEnum)9), "how you will pay");
    }

    // --- tips ---

    [Fact]
    public async Task Submit_ATip_IsStoredAndReturned_ButIsNotPartOfTheTotal()
    {
        var dto = await Submit(Request(amount: 500, tips: 20));

        dto!.Tips.ShouldBe(20);
        dto.Total.ShouldBe(150);
        await using var db = TestDb.Create(_db);
        (await db.Orders.SingleAsync()).Tips.ShouldBe(20);
    }

    [Fact]
    public async Task Submit_ACashTipMustBeCoveredByTheAmount_AndChangeTakesItOut()
    {
        await ShouldRejectAsync(Request(amount: 160, tips: 20), "total and tip of PHP 170.00");

        var dto = await Submit(Request(amount: 200, tips: 20));
        dto.ShouldNotBeNull();
        await using var db = TestDb.Create(_db);
        var order = await db.Orders.SingleAsync();
        order.AmountReceived.ShouldBe(200);
        order.ChangeAmount.ShouldBe(30, "200 paid - 150 total - 20 tip");
    }

    [Fact]
    public async Task Submit_CashExactlyCoveringTotalAndTip_LeavesNoChange()
    {
        await Submit(Request(amount: 170, tips: 20));

        await using var db = TestDb.Create(_db);
        (await db.Orders.SingleAsync()).ChangeAmount.ShouldBe(0);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0.0)]
    [InlineData(0.004)]
    public async Task Submit_NoTipOrZero_StoresNoTip(double? tip)
    {
        await Submit(Request(amount: 500, tips: tip is null ? null : (decimal)tip));

        await using var db = TestDb.Create(_db);
        (await db.Orders.SingleAsync()).Tips.ShouldBeNull();
    }

    [Fact]
    public async Task Submit_ATipIsRoundedToTheCent()
    {
        await Submit(Request(amount: 500, tips: 12.345m));

        await using var db = TestDb.Create(_db);
        (await db.Orders.SingleAsync()).Tips.ShouldBe(12.35m);
    }

    [Fact]
    public async Task Submit_ANegativeOrAbsurdTip_IsRejected()
    {
        await ShouldRejectAsync(Request(tips: -1), "cannot be negative");
        await ShouldRejectAsync(Request(tips: SubmitPublicOrderHandler.MaxTip + 1), "too large");
    }

    [Fact]
    public async Task Submit_ATipWithGCash_IsStoredWithoutACashAmount()
    {
        var dto = await Submit(Request(payment: PaymentMethodEnum.GCash, amount: null, tips: 25));

        dto!.Tips.ShouldBe(25);
        await using var db = TestDb.Create(_db);
        var order = await db.Orders.SingleAsync();
        order.Tips.ShouldBe(25);
        order.AmountReceived.ShouldBeNull();
        order.ChangeAmount.ShouldBeNull();
    }

    [Fact]
    public async Task Submit_AnOrderWithoutATip_ShowsNoTipToTheCustomer()
    {
        (await Submit(Request()))!.Tips.ShouldBeNull();
    }

    // --- limits and set-up ---

    [Fact]
    public async Task Submit_StopsAtFiveOrdersWaitingForConfirmation()
    {
        await AddWaitingOrdersAsync(_customer.Id, SubmitPublicOrderHandler.MaxWaitingOrders);
        var before = await OrderCountAsync();

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Submit(Request()));

        ex.Message.ShouldContain("waiting for confirmation");
        (await OrderCountAsync()).ShouldBe(before);
    }

    [Fact]
    public async Task Submit_OnlyThisCustomersWaitingLinkOrdersCountTowardsTheLimit()
    {
        var other = new Customer
        {
            Id = Guid.NewGuid(),
            FirstName = "Ben",
            LastName = "Lee",
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = _staffId
        };
        await TestDb.SaveAsync(_db, other);
        await AddWaitingOrdersAsync(other.Id, 10);
        await AddWaitingOrdersAsync(_customer.Id, 10, OrderStatusEnum.Pending);
        await AddWaitingOrdersAsync(_customer.Id, 10, OrderStatusEnum.Completed);
        await AddWaitingOrdersAsync(_customer.Id, 10, OrderStatusEnum.PendingApproval, OrderSourceEnum.Pos);
        await AddWaitingOrdersAsync(_customer.Id, SubmitPublicOrderHandler.MaxWaitingOrders - 1);

        (await Submit(Request())).ShouldNotBeNull();
    }

    [Fact]
    public async Task Submit_WithoutTheSystemUser_FailsWithAFriendlyMessageAndCreatesNothing()
    {
        await using (var db = TestDb.Create(_db))
        {
            db.Users.Remove(await db.Users.SingleAsync());
            await db.SaveChangesAsync();
        }

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Submit(Request()));

        ex.Message.ShouldContain("not available right now");
        (await OrderCountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Submit_AMissingRequest_IsRejected()
    {
        var handler = new SubmitPublicOrderHandler(
            TestDb.Create(_db), RealSender(), NullLogger<SubmitPublicOrderHandler>.Instance, TimeProvider.System);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            handler.Handle(new SubmitPublicOrderCommand(_link.Token, null!), CancellationToken.None));
    }

    // --- the link is checked again right before the order is created ---

    [Fact]
    public async Task Submit_ALinkThatExpiresWhileTheRequestIsBeingValidated_CreatesNothing()
    {
        var expires = DateTime.UtcNow.AddMinutes(5);
        await using (var db = TestDb.Create(_db))
        {
            (await db.ShortLinks.SingleAsync()).ExpiresAt = expires;
            await db.SaveChangesAsync();
        }

        // Valid when the request starts, past its end date by the time the order would be created.
        var clock = new SteppingTimeProvider(new DateTimeOffset(expires.AddMinutes(-1)), new DateTimeOffset(expires.AddSeconds(1)));
        var sender = RealSender();

        var result = await Submit(Request(), clock: clock, sender: sender);

        result.ShouldBeNull();
        clock.Calls.ShouldBe(2, "once at the start and once more before creating");
        (await OrderCountAsync()).ShouldBe(0);
        await sender.DidNotReceiveWithAnyArgs().Send(Arg.Any<IRequest<OrderDto>>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Submit_ALinkStillValidAtBothChecks_CreatesTheOrder()
    {
        var expires = DateTime.UtcNow.AddMinutes(5);
        await using (var db = TestDb.Create(_db))
        {
            (await db.ShortLinks.SingleAsync()).ExpiresAt = expires;
            await db.SaveChangesAsync();
        }

        var clock = new SteppingTimeProvider(new DateTimeOffset(expires.AddMinutes(-2)), new DateTimeOffset(expires.AddMinutes(-1)));

        (await Submit(Request(), clock: clock)).ShouldNotBeNull();
        (await OrderCountAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task Submit_ARevokedLinkIsNeverReusedForANewOrder_ButEarlierOrdersAreUntouched()
    {
        await Submit(Request());

        await using (var db = TestDb.Create(_db))
        {
            (await db.ShortLinks.SingleAsync()).RevokedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }

        (await Submit(Request())).ShouldBeNull();
        (await OrderCountAsync()).ShouldBe(1);
        await using var check = TestDb.Create(_db);
        (await check.Orders.SingleAsync()).StatusId.ShouldBe((int)OrderStatusEnum.PendingApproval);
    }
}
