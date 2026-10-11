using System.Reflection;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.OrderLinks;
using WTF.Api.Features.OrderLinks.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Products.Enums;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.OrderLinks;

public class PublicOrderLinkTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _staffId = Guid.NewGuid();

    // --- seeding ---

    private async Task<Customer> AddCustomerAsync(string first = "Ana", bool allow = true, bool active = true,
        string? address = "12 Main St")
    {
        var customer = new Customer
        {
            Id = Guid.NewGuid(), FirstName = first, LastName = "Cruz", Address = address, IsActive = active,
            AllowOrderingLink = allow, CreatedAt = DateTime.UtcNow, CreatedBy = _staffId
        };
        await TestDb.SaveAsync(_db, customer);
        return customer;
    }

    private async Task<ShortLink> AddLinkAsync(Guid customerId, string? token = null, DateTime? expiresAt = null,
        DateTime? revokedAt = null, string targetType = "CustomerOrder")
    {
        var link = new ShortLink
        {
            Id = Guid.NewGuid(), Token = token ?? OrderLinkToken.Generate(), TargetType = targetType,
            TargetId = customerId, ExpiresAt = expiresAt, RevokedAt = revokedAt,
            CreatedAt = DateTime.UtcNow.AddHours(-1), CreatedBy = _staffId
        };
        await TestDb.SaveAsync(_db, link);
        return link;
    }

    private async Task<Product> AddProductAsync(string name, decimal price, bool active = true, bool addOn = false)
    {
        var product = new Product
        {
            Id = Guid.NewGuid(), Name = name, Code = name.ToUpperInvariant(), Price = price, CategoryId = 1,
            IsActive = active, IsAddOn = addOn, CreatedAt = DateTime.UtcNow, CreatedBy = _staffId
        };
        await TestDb.SaveAsync(_db, product);
        return product;
    }

    private async Task<Order> AddOrderAsync(Guid? customerId, OrderSourceEnum source = OrderSourceEnum.CustomerLink,
        OrderStatusEnum status = OrderStatusEnum.PendingApproval, DateTime? createdAt = null,
        string? rejectionReason = null, Guid? linkId = null)
    {
        var order = new Order
        {
            Id = Guid.NewGuid(), OrderNumber = Random.Shared.Next(1, 1_000_000), CustomerId = customerId,
            Source = (byte)source, StatusId = (int)status, CreatedAt = createdAt ?? DateTime.UtcNow,
            CreatedBy = _staffId, RejectionReason = rejectionReason, OrderLinkId = linkId,
            FulfillmentType = (byte)FulfillmentTypeEnum.Delivery, DeliveryAddress = "5 Side St",
            ContactNumber = "0917", PaymentMethodId = (int)PaymentMethodEnum.Cash, AmountReceived = 500,
            SpecialInstructions = "No ice"
        };
        await TestDb.SaveAsync(_db, order);
        return order;
    }

    private async Task<OrderItem> AddLineAsync(Guid orderId, Guid productId, int quantity = 1, decimal? price = null,
        Guid? parentId = null)
    {
        var item = new OrderItem
        {
            Id = Guid.NewGuid(), OrderId = orderId, ProductId = productId, Quantity = quantity, Price = price,
            ParentOrderItemId = parentId
        };
        await TestDb.SaveAsync(_db, item);
        return item;
    }

    private Task<OrderLinkAccessResult?> Resolve(string? token)
    {
        var db = TestDb.Create(_db);
        return OrderLinkAccess.ResolveAsync(db, token, CancellationToken.None);
    }

    private Task<PublicOrderLinkDto?> OpenLink(string token) =>
        new GetPublicOrderLinkHandler(TestDb.Create(_db), TestRequest.None())
            .Handle(new GetPublicOrderLinkQuery(token), CancellationToken.None);

    private GetPublicOrdersHandler Orders() => new(TestDb.Create(_db));

    // --- the shared token check ---

    [Fact]
    public async Task Access_ValidToken_ReturnsLinkAndCustomer()
    {
        var customer = await AddCustomerAsync();
        var link = await AddLinkAsync(customer.Id);

        var result = await Resolve(link.Token);

        result.ShouldNotBeNull();
        result.Customer.Id.ShouldBe(customer.Id);
        result.Link.Id.ShouldBe(link.Id);
    }

    [Fact]
    public async Task Access_LinkWithFutureEndDate_IsValid()
    {
        var customer = await AddCustomerAsync();
        var link = await AddLinkAsync(customer.Id, expiresAt: DateTime.UtcNow.AddDays(1));

        (await Resolve(link.Token)).ShouldNotBeNull();
    }

    [Fact]
    public async Task Access_EveryInvalidState_ReturnsNull()
    {
        var good = await AddCustomerAsync();
        var disabled = await AddCustomerAsync(allow: false);
        var inactive = await AddCustomerAsync(active: false);

        var expired = await AddLinkAsync(good.Id, expiresAt: DateTime.UtcNow.AddSeconds(-1));
        var revoked = await AddLinkAsync(good.Id, revokedAt: DateTime.UtcNow.AddMinutes(-1));
        var loyalty = await AddLinkAsync(good.Id, targetType: "Loyalty");
        var orderingDisabled = await AddLinkAsync(disabled.Id);
        var customerInactive = await AddLinkAsync(inactive.Id);
        var noCustomer = await AddLinkAsync(Guid.NewGuid());

        foreach (var token in new[]
                 {
                     expired.Token, revoked.Token, loyalty.Token, orderingDisabled.Token, customerInactive.Token,
                     noCustomer.Token, "does-not-exist", "", "   ", null, new string('a', 65)
                 })
        {
            (await Resolve(token)).ShouldBeNull($"token '{token}' should be rejected");
        }
    }

    [Fact]
    public async Task Access_TokenInDifferentCase_IsRejected()
    {
        var customer = await AddCustomerAsync();
        var link = await AddLinkAsync(customer.Id, token: "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe");

        (await Resolve(link.Token)).ShouldNotBeNull();
        (await Resolve(link.Token.ToLowerInvariant())).ShouldBeNull();
        (await Resolve(link.Token.ToUpperInvariant())).ShouldBeNull();
    }

    // --- checking again right before something is finalized ---

    [Fact]
    public async Task StillValid_AnActiveLink_IsValid()
    {
        var customer = await AddCustomerAsync();
        var link = await AddLinkAsync(customer.Id, expiresAt: DateTime.UtcNow.AddHours(1));

        (await OrderLinkAccess.IsStillValidAsync(TestDb.Create(_db), link.Id, DateTime.UtcNow, default)).ShouldBeTrue();
    }

    [Fact]
    public async Task StillValid_EveryWayALinkStopsBeingValid_IsNotValid()
    {
        var good = await AddCustomerAsync();
        var disabled = await AddCustomerAsync(allow: false);
        var inactive = await AddCustomerAsync(active: false);
        var now = DateTime.UtcNow;

        var revoked = await AddLinkAsync(good.Id, revokedAt: now.AddMinutes(-1));
        var expired = await AddLinkAsync(good.Id, expiresAt: now.AddSeconds(-1));
        var endsNow = await AddLinkAsync(good.Id, expiresAt: now);
        var ordering = await AddLinkAsync(disabled.Id);
        var gone = await AddLinkAsync(inactive.Id);
        var loyalty = await AddLinkAsync(good.Id, targetType: "Loyalty");

        foreach (var id in new[] { revoked.Id, expired.Id, endsNow.Id, ordering.Id, gone.Id, loyalty.Id, Guid.NewGuid() })
        {
            (await OrderLinkAccess.IsStillValidAsync(TestDb.Create(_db), id, now, default)).ShouldBeFalse();
        }
    }

    [Fact]
    public async Task StillValid_SeesARevokeMadeAfterTheLinkWasAlreadyLoaded()
    {
        var customer = await AddCustomerAsync();
        var link = await AddLinkAsync(customer.Id);
        var db = TestDb.Create(_db);

        // The first check loads (and tracks) the link in this context...
        (await OrderLinkAccess.ResolveAsync(db, link.Token, default)).ShouldNotBeNull();

        // ...then someone else revokes it.
        await using (var other = TestDb.Create(_db))
        {
            (await other.ShortLinks.SingleAsync()).RevokedAt = DateTime.UtcNow;
            await other.SaveChangesAsync();
        }

        // A second ResolveAsync would still see the tracked, stale copy; the re-check must not.
        (await OrderLinkAccess.IsStillValidAsync(db, link.Id, DateTime.UtcNow, default)).ShouldBeFalse();
    }

    [Fact]
    public async Task StillValid_SeesOrderingBeingSwitchedOffAfterTheCustomerWasAlreadyLoaded()
    {
        var customer = await AddCustomerAsync();
        var link = await AddLinkAsync(customer.Id);
        var db = TestDb.Create(_db);
        (await OrderLinkAccess.ResolveAsync(db, link.Token, default)).ShouldNotBeNull();

        await using (var other = TestDb.Create(_db))
        {
            (await other.Customers.SingleAsync()).AllowOrderingLink = false;
            await other.SaveChangesAsync();
        }

        (await OrderLinkAccess.IsStillValidAsync(db, link.Id, DateTime.UtcNow, default)).ShouldBeFalse();
    }

    [Fact]
    public async Task Resolve_UsesTheTimeItIsGiven()
    {
        var customer = await AddCustomerAsync();
        var end = DateTime.UtcNow.AddMinutes(10);
        var link = await AddLinkAsync(customer.Id, expiresAt: end);

        (await OrderLinkAccess.ResolveAsync(TestDb.Create(_db), link.Token, default, end.AddMinutes(-1))).ShouldNotBeNull();
        (await OrderLinkAccess.ResolveAsync(TestDb.Create(_db), link.Token, default, end.AddMinutes(1))).ShouldBeNull();
    }

    // --- opening a link ---

    [Fact]
    public async Task OpenLink_ReturnsFirstNameAddressEndDateAndSlimCatalog()
    {
        var customer = await AddCustomerAsync("Maria");
        var end = DateTime.UtcNow.AddDays(3);
        var link = await AddLinkAsync(customer.Id, expiresAt: end);
        var latte = await AddProductAsync("Latte", 150);
        await AddProductAsync("Retired", 99, active: false);
        var syrup = await AddProductAsync("Syrup", 30, addOn: true);
        await TestDb.SaveAsync(_db, new ProductAddOn
            { ProductId = latte.Id, AddOnId = syrup.Id, AddOnTypeId = (int)AddOnTypeEnum.Extra, IsActive = true });
        await TestDb.SaveAsync(_db, new ProductAddOnPriceOverride
            { Id = Guid.NewGuid(), ProductId = latte.Id, AddOnId = syrup.Id, Price = 20, IsActive = true, CreatedAt = DateTime.UtcNow });

        var dto = await OpenLink(link.Token);

        dto.ShouldNotBeNull();
        dto.FirstName.ShouldBe("Maria");
        dto.Address.ShouldBe("12 Main St");
        dto.ExpiresAt.ShouldBe(end);
        dto.Catalog.Products.Select(p => p.Name).ShouldBe(["Latte"]);
        dto.Catalog.Products[0].Price.ShouldBe(150);
        dto.Catalog.Products[0].AddOnCount.ShouldBe(1);
        var group = dto.Catalog.AddOnsByProductId[latte.Id].ShouldHaveSingleItem();
        group.DisplayName.ShouldBe("Extra");
        group.Options.ShouldHaveSingleItem().Price.ShouldBe(20, "the product's add-on price override applies");
    }

    private async Task AddCustomerImageAsync(Guid customerId, string url)
    {
        var imageId = Guid.NewGuid();
        await TestDb.SaveAsync(_db,
            new Image { ImageId = imageId, ImageUrl = url, UploadedAt = DateTime.UtcNow },
            new CustomerImage { CustomerId = customerId, ImageId = imageId });
    }

    [Fact]
    public async Task OpenLink_ReturnsTheCustomersProfilePicture()
    {
        var customer = await AddCustomerAsync("Maria");
        var link = await AddLinkAsync(customer.Id);
        await AddCustomerImageAsync(customer.Id, "https://cdn.example.com/maria.png");

        var dto = await OpenLink(link.Token);

        dto!.ImageUrl.ShouldBe("https://cdn.example.com/maria.png");
    }

    [Fact]
    public async Task OpenLink_CustomerWithoutAPicture_HasNoImageUrl()
    {
        var customer = await AddCustomerAsync();
        var link = await AddLinkAsync(customer.Id);

        (await OpenLink(link.Token))!.ImageUrl.ShouldBeNull();
    }

    [Fact]
    public async Task OpenLink_ARelativePictureBecomesAnAbsoluteAddressOnThisServer()
    {
        var customer = await AddCustomerAsync();
        var link = await AddLinkAsync(customer.Id);
        await AddCustomerImageAsync(customer.Id, "/uploads/customers/maria.png");

        var accessor = TestRequest.As(Guid.NewGuid());
        accessor.HttpContext!.Request.Scheme = "https";
        accessor.HttpContext.Request.Host = new Microsoft.AspNetCore.Http.HostString("shop.example.com");
        var dto = await new GetPublicOrderLinkHandler(TestDb.Create(_db), accessor)
            .Handle(new GetPublicOrderLinkQuery(link.Token), CancellationToken.None);

        dto!.ImageUrl.ShouldBe("https://shop.example.com/uploads/customers/maria.png");
    }

    [Fact]
    public async Task OpenLink_NeverShowsAnotherCustomersPicture()
    {
        var ana = await AddCustomerAsync("Ana");
        var ben = await AddCustomerAsync("Ben");
        var link = await AddLinkAsync(ana.Id);
        await AddCustomerImageAsync(ben.Id, "https://cdn.example.com/ben.png");

        (await OpenLink(link.Token))!.ImageUrl.ShouldBeNull();
    }

    [Fact]
    public async Task OpenLink_InvalidToken_ReturnsNull()
    {
        (await OpenLink("nope")).ShouldBeNull();
    }

    [Fact]
    public async Task OpenLink_RecordsLastUsedAtButNotOnEveryRequest()
    {
        var customer = await AddCustomerAsync();
        var link = await AddLinkAsync(customer.Id);

        await OpenLink(link.Token);
        DateTime? first;
        await using (var db = TestDb.Create(_db))
        {
            first = (await db.ShortLinks.SingleAsync()).LastUsedAt;
        }

        first.ShouldNotBeNull();
        first.Value.ShouldBe(DateTime.UtcNow, TimeSpan.FromSeconds(10));

        await OpenLink(link.Token);
        await using (var db = TestDb.Create(_db))
        {
            (await db.ShortLinks.SingleAsync()).LastUsedAt.ShouldBe(first, "a second open within a minute does not write");
        }
    }

    [Fact]
    public async Task OpenLink_RefreshesLastUsedAtWhenItIsOld()
    {
        var customer = await AddCustomerAsync();
        var link = await AddLinkAsync(customer.Id);
        await using (var db = TestDb.Create(_db))
        {
            (await db.ShortLinks.SingleAsync()).LastUsedAt = DateTime.UtcNow.AddHours(-2);
            await db.SaveChangesAsync();
        }

        await OpenLink(link.Token);

        await using var check = TestDb.Create(_db);
        (await check.ShortLinks.SingleAsync()).LastUsedAt!.Value.ShouldBe(DateTime.UtcNow, TimeSpan.FromSeconds(10));
    }

    [Fact]
    public async Task OpenLink_InvalidTokenDoesNotTouchAnyLink()
    {
        var customer = await AddCustomerAsync();
        await AddLinkAsync(customer.Id, revokedAt: DateTime.UtcNow.AddMinutes(-1));

        await OpenLink("nope");

        await using var db = TestDb.Create(_db);
        (await db.ShortLinks.SingleAsync()).LastUsedAt.ShouldBeNull();
    }

    [Fact]
    public void PublicDtos_CarryNoAuditFieldsStaffOrUserIds()
    {
        var forbidden = new[] { "CreatedBy", "UpdatedBy", "CreatedAt", "UpdatedAt", "UserId", "StaffName", "Customers", "Note" };
        var types = typeof(PublicOrderLinkDto).Assembly.GetTypes()
            .Where(t => t.Namespace == "WTF.Api.Features.OrderLinks.DTOs" && t.Name.StartsWith("Public"));

        foreach (var type in types)
        {
            var names = type.GetProperties(BindingFlags.Public | BindingFlags.Instance).Select(p => p.Name).ToList();
            foreach (var bad in forbidden)
            {
                // An order's own created time is the order time the customer placed it, so it is allowed there.
                if (type == typeof(PublicOrderDto) && bad == "CreatedAt")
                {
                    continue;
                }

                names.ShouldNotContain(bad, $"{type.Name} must not expose {bad}");
            }
        }
    }

    // --- my orders ---

    [Fact]
    public async Task Orders_ReturnOnlyThisCustomersLinkOrdersNewestFirst()
    {
        var ana = await AddCustomerAsync("Ana");
        var ben = await AddCustomerAsync("Ben");
        var link = await AddLinkAsync(ana.Id);
        var oldLink = await AddLinkAsync(ana.Id, revokedAt: DateTime.UtcNow.AddDays(-1));
        var older = await AddOrderAsync(ana.Id, createdAt: DateTime.UtcNow.AddHours(-3), linkId: oldLink.Id);
        var newer = await AddOrderAsync(ana.Id, createdAt: DateTime.UtcNow.AddHours(-1), linkId: link.Id);
        await AddOrderAsync(ana.Id, OrderSourceEnum.Pos, OrderStatusEnum.Completed);
        await AddOrderAsync(ben.Id);
        await AddOrderAsync(null);

        var result = await Orders().Handle(new GetPublicOrdersQuery(link.Token), CancellationToken.None);

        result.ShouldNotBeNull();
        result.TotalCount.ShouldBe(2);
        result.Items.Select(o => o.Id).ShouldBe([newer.Id, older.Id]);
    }

    [Fact]
    public async Task Orders_ArePaged()
    {
        var ana = await AddCustomerAsync();
        var link = await AddLinkAsync(ana.Id);
        for (var i = 0; i < 5; i++)
        {
            await AddOrderAsync(ana.Id, createdAt: DateTime.UtcNow.AddMinutes(-i));
        }

        var page2 = await Orders().Handle(new GetPublicOrdersQuery(link.Token, 2, 2), CancellationToken.None);

        page2!.TotalCount.ShouldBe(5);
        page2.Page.ShouldBe(2);
        page2.PageSize.ShouldBe(2);
        page2.Items.Count.ShouldBe(2);
    }

    [Fact]
    public async Task Orders_PageSizeIsCappedAndBadPagesFallBack()
    {
        var ana = await AddCustomerAsync();
        var link = await AddLinkAsync(ana.Id);

        var result = await Orders().Handle(new GetPublicOrdersQuery(link.Token, -3, 5000), CancellationToken.None);

        result!.Page.ShouldBe(1);
        result.PageSize.ShouldBe(50);
    }

    [Fact]
    public async Task Orders_InvalidToken_ReturnsNull()
    {
        (await Orders().Handle(new GetPublicOrdersQuery("nope"), CancellationToken.None)).ShouldBeNull();
        (await Orders().Handle(new GetPublicOrderQuery("nope", Guid.NewGuid()), CancellationToken.None)).ShouldBeNull();
    }

    [Fact]
    public async Task Order_ShowsItemsAddOnsTotalAndDetailsForTheCustomer()
    {
        var ana = await AddCustomerAsync();
        var link = await AddLinkAsync(ana.Id);
        var latte = await AddProductAsync("Latte", 150);
        var syrup = await AddProductAsync("Syrup", 30, addOn: true);
        await TestDb.SaveAsync(_db, new ProductAddOnPriceOverride
            { Id = Guid.NewGuid(), ProductId = latte.Id, AddOnId = syrup.Id, Price = 20, IsActive = true, CreatedAt = DateTime.UtcNow });
        var order = await AddOrderAsync(ana.Id, linkId: link.Id);
        var parent = await AddLineAsync(order.Id, latte.Id, quantity: 2);
        await AddLineAsync(order.Id, syrup.Id, parentId: parent.Id);

        var dto = await Orders().Handle(new GetPublicOrderQuery(link.Token, order.Id), CancellationToken.None);

        dto.ShouldNotBeNull();
        dto.OrderNumber.ShouldBe(order.OrderNumber);
        dto.StatusLabel.ShouldBe("Waiting for confirmation");
        dto.StatusKind.ShouldBe("waiting");
        var item = dto.Items.ShouldHaveSingleItem();
        item.Name.ShouldBe("Latte");
        item.Quantity.ShouldBe(2);
        item.UnitPrice.ShouldBe(150);
        var addOn = item.AddOns.ShouldHaveSingleItem();
        addOn.Name.ShouldBe("Syrup");
        addOn.UnitPrice.ShouldBe(20, "the product's add-on override price");
        dto.Total.ShouldBe((150 + 20) * 2);
        dto.FulfillmentType.ShouldBe("Delivery");
        dto.DeliveryAddress.ShouldBe("5 Side St");
        dto.ContactNumber.ShouldBe("0917");
        dto.PaymentMethod.ShouldBe("Cash");
        dto.AmountReceived.ShouldBe(500);
        dto.SpecialInstructions.ShouldBe("No ice");
    }

    [Fact]
    public async Task Order_UsesStoredPricesWhenPresent()
    {
        var ana = await AddCustomerAsync();
        var link = await AddLinkAsync(ana.Id);
        var latte = await AddProductAsync("Latte", 150);
        var order = await AddOrderAsync(ana.Id, status: OrderStatusEnum.Completed);
        await AddLineAsync(order.Id, latte.Id, quantity: 1, price: 120);

        var dto = await Orders().Handle(new GetPublicOrderQuery(link.Token, order.Id), CancellationToken.None);

        dto!.Items.Single().UnitPrice.ShouldBe(120);
        dto.Total.ShouldBe(120);
    }

    [Fact]
    public async Task Order_OfAnotherCustomerOrAPosOrder_IsNotFound()
    {
        var ana = await AddCustomerAsync("Ana");
        var ben = await AddCustomerAsync("Ben");
        var link = await AddLinkAsync(ana.Id);
        var bens = await AddOrderAsync(ben.Id);
        var pos = await AddOrderAsync(ana.Id, OrderSourceEnum.Pos, OrderStatusEnum.Completed);

        (await Orders().Handle(new GetPublicOrderQuery(link.Token, bens.Id), CancellationToken.None)).ShouldBeNull();
        (await Orders().Handle(new GetPublicOrderQuery(link.Token, pos.Id), CancellationToken.None)).ShouldBeNull();
        (await Orders().Handle(new GetPublicOrderQuery(link.Token, Guid.NewGuid()), CancellationToken.None)).ShouldBeNull();
    }

    // --- customer-facing status ---

    [Theory]
    [InlineData(OrderStatusEnum.PendingApproval, null, "Waiting for confirmation", "waiting")]
    [InlineData(OrderStatusEnum.Pending, null, "Accepted", "accepted")]
    [InlineData(OrderStatusEnum.Completed, null, "Completed", "completed")]
    [InlineData(OrderStatusEnum.Cancelled, "Out of stock", "Rejected", "rejected")]
    [InlineData(OrderStatusEnum.Cancelled, null, "Cancelled", "cancelled")]
    [InlineData(OrderStatusEnum.Cancelled, "  ", "Cancelled", "cancelled")]
    [InlineData(OrderStatusEnum.Refunded, null, "Refunded", "refunded")]
    public void StatusOf_MapsToCustomerFacingLabels(OrderStatusEnum status, string? reason, string label, string kind)
    {
        PublicOrderMapping.StatusOf((int)status, reason).ShouldBe((label, kind));
    }

    [Theory]
    [InlineData(FulfillmentTypeEnum.Pickup, "Ready for pickup")]
    [InlineData(FulfillmentTypeEnum.Delivery, "Ready for delivery")]
    public void StatusOf_AnAcceptedOrderThatIsReady_SaysWhereToGetIt(FulfillmentTypeEnum fulfillment, string label)
    {
        PublicOrderMapping.StatusOf((int)OrderStatusEnum.Pending, null, DateTime.UtcNow, (byte)fulfillment)
            .ShouldBe((label, "ready"));
    }

    [Fact]
    public void StatusOf_ReadyOnlyMattersWhileTheOrderIsStillAccepted()
    {
        PublicOrderMapping.StatusOf((int)OrderStatusEnum.Completed, null, DateTime.UtcNow, 0).Kind.ShouldBe("completed");
        PublicOrderMapping.StatusOf((int)OrderStatusEnum.Cancelled, "no", DateTime.UtcNow, 0).Kind.ShouldBe("rejected");
    }

    [Fact]
    public async Task Order_CarriesTheTimesForTheTimeline()
    {
        var ana = await AddCustomerAsync();
        var link = await AddLinkAsync(ana.Id);
        var accepted = DateTime.UtcNow.AddMinutes(-30);
        var ready = DateTime.UtcNow.AddMinutes(-10);
        var done = DateTime.UtcNow.AddMinutes(-2);
        var order = await AddOrderAsync(ana.Id, status: OrderStatusEnum.Completed);
        await using (var db = TestDb.Create(_db))
        {
            var row = await db.Orders.SingleAsync(o => o.Id == order.Id);
            row.AcceptedAt = accepted;
            row.ReadyAt = ready;
            row.UpdatedAt = done;
            await db.SaveChangesAsync();
        }

        var dto = await Orders().Handle(new GetPublicOrderQuery(link.Token, order.Id), CancellationToken.None);

        dto!.AcceptedAt.ShouldBe(accepted);
        dto.ReadyAt.ShouldBe(ready);
        dto.FinishedAt.ShouldBe(done);
    }

    [Fact]
    public async Task Order_StillOpenHasNoFinishTime()
    {
        var ana = await AddCustomerAsync();
        var link = await AddLinkAsync(ana.Id);
        var order = await AddOrderAsync(ana.Id, status: OrderStatusEnum.Pending);
        await using (var db = TestDb.Create(_db))
        {
            (await db.Orders.SingleAsync(o => o.Id == order.Id)).UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }

        var dto = await Orders().Handle(new GetPublicOrderQuery(link.Token, order.Id), CancellationToken.None);

        dto!.FinishedAt.ShouldBeNull();
    }

    [Fact]
    public async Task Order_RejectedShowsTheReason()
    {
        var ana = await AddCustomerAsync();
        var link = await AddLinkAsync(ana.Id);
        var order = await AddOrderAsync(ana.Id, status: OrderStatusEnum.Cancelled, rejectionReason: "Closed today");

        var dto = await Orders().Handle(new GetPublicOrderQuery(link.Token, order.Id), CancellationToken.None);

        dto!.StatusLabel.ShouldBe("Rejected");
        dto.RejectionReason.ShouldBe("Closed today");
    }
}
