using MediatR;
using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Customers;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Orders;

public class OrderCustomerAddressTests
{
    private readonly Guid _userId = Guid.NewGuid();
    private readonly OrderSeed _data = new(TestDb.NewName());
    private readonly IAuditService _audit = TestFakes.Audit();

    private CreateOrderHandler Creator() =>
        TestFakes.CreateOrderHandler(_data.Open(), TestRequest.As(_userId, AppRoles.Admin), _audit);

    private UpdateOrderHandler Updater() =>
        TestFakes.UpdateOrderHandler(_data.Open(), TestRequest.As(_userId, AppRoles.Admin), _audit);

    private Guid AddCustomer(string first, string? last, string? address)
    {
        using var db = _data.Open();
        var id = Guid.NewGuid();
        db.Customers.Add(new Customer
        {
            Id = id,
            FirstName = first,
            LastName = last,
            Address = address,
            IsActive = true,
            CreatedAt = FixedClock.Today,
            CreatedBy = _userId,
        });
        db.SaveChanges();
        return id;
    }

    private static CreateOrderCommand Create(Guid productId, Guid? customerId, string? address = null,
        OrderStatusEnum status = OrderStatusEnum.Pending) =>
        new()
        {
            CustomerId = customerId,
            CustomerAddress = address,
            Status = status,
            Items = [new OrderItemRequestDto(productId, 1, [], null, null)],
        };

    private static UpdateOrderCommand Update(Guid id, Guid? customerId, Guid productId, string? address,
        OrderStatusEnum status = OrderStatusEnum.Pending, bool isOverride = false, string? reason = null) =>
        new()
        {
            Id = id,
            CustomerId = customerId,
            CustomerAddress = address,
            Status = status,
            IsOverride = isOverride,
            OverrideReason = reason,
            Items = [new OrderItemRequestDto(productId, 1, [], null, null)],
        };

    private async Task<string?> SavedAddress(Guid orderId)
    {
        await using var db = _data.Open();
        return (await db.Orders.SingleAsync(o => o.Id == orderId)).CustomerAddress;
    }

    [Fact]
    public async Task Create_GivenAddress_IsTrimmedAndKeptOnTheOrder()
    {
        var product = _data.AddProduct("Latte", 100);
        var customer = AddCustomer("Ana", null, "Home St");

        var dto = await Creator().Handle(Create(product, customer, "  12 Side St "), CancellationToken.None);

        dto.CustomerAddress.ShouldBe("12 Side St");
        (await SavedAddress(dto.Id)).ShouldBe("12 Side St");
    }

    [Fact]
    public async Task Create_NoAddressSent_FallsBackToTheCustomersSavedAddress()
    {
        var product = _data.AddProduct("Latte", 100);
        var customer = AddCustomer("Ana", "Cruz", "Home St");

        var dto = await Creator().Handle(Create(product, customer), CancellationToken.None);

        dto.CustomerAddress.ShouldBe("Home St");
        (await SavedAddress(dto.Id)).ShouldBe("Home St");
    }

    [Fact]
    public async Task Create_BlankAddressSent_MeansNoAddress()
    {
        var product = _data.AddProduct("Latte", 100);
        var customer = AddCustomer("Ana", "Cruz", "Home St");

        var dto = await Creator().Handle(Create(product, customer, "   "), CancellationToken.None);

        dto.CustomerAddress.ShouldBeNull();
        (await SavedAddress(dto.Id)).ShouldBeNull();
    }

    [Fact]
    public async Task Create_WalkInOrder_HasNoAddressEvenIfOneIsSent()
    {
        var product = _data.AddProduct("Latte", 100);

        var dto = await Creator().Handle(Create(product, null, "Somewhere"), CancellationToken.None);

        dto.CustomerAddress.ShouldBeNull();
        (await SavedAddress(dto.Id)).ShouldBeNull();
    }

    [Fact]
    public async Task Create_AddressOverOneHundredFiftyCharacters_IsRefusedAndNothingIsSaved()
    {
        var product = _data.AddProduct("Latte", 100);
        var customer = AddCustomer("Ana", "Cruz", null);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Creator().Handle(Create(product, customer, new string('a', 151)), CancellationToken.None));

        await using var db = _data.Open();
        (await db.Orders.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task EditingTheCustomerLater_DoesNotChangeTheOrdersAddress()
    {
        var product = _data.AddProduct("Latte", 100);
        var customer = AddCustomer("Ana", "Cruz", "Old Rd");
        var order = await Creator().Handle(Create(product, customer), CancellationToken.None);

        await new UpdateCustomerHandler(_data.Open(), TestRequest.As(_userId), _audit)
            .Handle(new UpdateCustomerCommand(customer, "Ana", "Cruz", "New Ave"), CancellationToken.None);

        (await SavedAddress(order.Id)).ShouldBe("Old Rd");
    }

    [Fact]
    public async Task Update_PendingOrder_TakesTheAddressSentAtCheckout()
    {
        var product = _data.AddProduct("Latte", 100);
        var customer = AddCustomer("Ana", "Cruz", "Home St");
        var order = await Creator().Handle(Create(product, customer), CancellationToken.None);

        var dto = await Updater().Handle(Update(order.Id, customer, product, "Office Blvd", OrderStatusEnum.Completed), CancellationToken.None);

        dto!.CustomerAddress.ShouldBe("Office Blvd");
        (await SavedAddress(order.Id)).ShouldBe("Office Blvd");
    }

    [Fact]
    public async Task Update_NoAddressSent_KeepsTheAddressOnTheOrder()
    {
        var product = _data.AddProduct("Latte", 100);
        var customer = AddCustomer("Ana", "Cruz", "Home St");
        var order = await Creator().Handle(Create(product, customer, "Office Blvd"), CancellationToken.None);

        await Updater().Handle(Update(order.Id, customer, product, null), CancellationToken.None);

        (await SavedAddress(order.Id)).ShouldBe("Office Blvd");
    }

    [Fact]
    public async Task Update_NewCustomerAndNoAddressSent_TakesTheNewCustomersSavedAddress()
    {
        var product = _data.AddProduct("Latte", 100);
        var ana = AddCustomer("Ana", "Cruz", "Home St");
        var ben = AddCustomer("Ben", "Reyes", "Ben Ave");
        var order = await Creator().Handle(Create(product, ana), CancellationToken.None);

        await Updater().Handle(Update(order.Id, ben, product, null), CancellationToken.None);

        (await SavedAddress(order.Id)).ShouldBe("Ben Ave");
    }

    [Fact]
    public async Task Update_BlankAddressSent_ClearsIt_AndWalkInHasNone()
    {
        var product = _data.AddProduct("Latte", 100);
        var customer = AddCustomer("Ana", "Cruz", "Home St");
        var order = await Creator().Handle(Create(product, customer), CancellationToken.None);

        await Updater().Handle(Update(order.Id, customer, product, ""), CancellationToken.None);
        (await SavedAddress(order.Id)).ShouldBeNull();

        await Updater().Handle(Update(order.Id, null, product, "Somewhere"), CancellationToken.None);
        (await SavedAddress(order.Id)).ShouldBeNull();
    }

    [Fact]
    public async Task Update_CompletedOrderWithoutOverride_IsRefusedSoTheAddressStaysLocked()
    {
        var product = _data.AddProduct("Latte", 100);
        var customer = AddCustomer("Ana", "Cruz", "Home St");
        var order = await Creator().Handle(Create(product, customer, null, OrderStatusEnum.Completed), CancellationToken.None);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Updater().Handle(Update(order.Id, customer, product, "Hacked", OrderStatusEnum.Completed), CancellationToken.None));

        (await SavedAddress(order.Id)).ShouldBe("Home St");
    }

    [Fact]
    public async Task Override_ChangesTheAddress_AndTheAuditHoldsOldAndNew()
    {
        var product = _data.AddProduct("Latte", 100);
        var customer = AddCustomer("Ana", "Cruz", "Home St");
        var order = await Creator().Handle(Create(product, customer, null, OrderStatusEnum.Completed), CancellationToken.None);

        var dto = await Updater().Handle(
            Update(order.Id, customer, product, " Office Blvd ", OrderStatusEnum.Completed, isOverride: true, reason: "wrong address"),
            CancellationToken.None);

        dto!.CustomerAddress.ShouldBe("Office Blvd");
        (await SavedAddress(order.Id)).ShouldBe("Office Blvd");
        await _audit.Received(1).LogAsync(
            AuditAction.OrderOverridden, AuditEntityType.Order, order.Id.ToString(),
            Arg.Is<object?>(v => v!.ToString()!.Contains("CustomerAddress = Home St")),
            Arg.Is<object?>(v => v!.ToString()!.Contains("CustomerAddress = Office Blvd")),
            Arg.Any<Guid?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Override_BlankAddress_ClearsItToNull()
    {
        var product = _data.AddProduct("Latte", 100);
        var customer = AddCustomer("Ana", "Cruz", "Home St");
        var order = await Creator().Handle(Create(product, customer, null, OrderStatusEnum.Completed), CancellationToken.None);

        await Updater().Handle(
            Update(order.Id, customer, product, "  ", OrderStatusEnum.Completed, isOverride: true, reason: "no address"),
            CancellationToken.None);

        (await SavedAddress(order.Id)).ShouldBeNull();
    }

    [Fact]
    public async Task Queries_ReturnTheOrdersAddress_AndTheListSearchFindsByIt()
    {
        var product = _data.AddProduct("Latte", 100);
        var customer = AddCustomer("Ana", null, "Home St");
        var withAddress = await Creator().Handle(Create(product, customer, "77 Mango Lane"), CancellationToken.None);
        var walkIn = await Creator().Handle(Create(product, null), CancellationToken.None);

        await using var db = _data.Open();
        var byId = await new GetOrderByIdHandler(db).Handle(new GetOrderByIdQuery(withAddress.Id), default);
        byId!.CustomerAddress.ShouldBe("77 Mango Lane");
        byId.CustomerName.ShouldBe("Ana");
        (await new GetOrderByIdHandler(db).Handle(new GetOrderByIdQuery(walkIn.Id), default))!.CustomerAddress.ShouldBeNull();

        var list = await new GetOrdersHandler(db).Handle(new GetOrdersQuery(), default);
        list.Single(o => o.Id == withAddress.Id).CustomerAddress.ShouldBe("77 Mango Lane");

        var paged = await new GetPagedOrdersHandler(db).Handle(new GetPagedOrdersQuery(SearchTerm: "mango"), default);
        paged.Items.Select(o => o.Id).ShouldBe([withAddress.Id]);
        paged.Items.Single().CustomerAddress.ShouldBe("77 Mango Lane");
    }

    [Fact]
    public async Task OfflineSync_KeepsTheAddressTheCashierTypedOnTheOrder()
    {
        var product = _data.AddProduct("Latte", 100);
        var customer = AddCustomer("Ana", "Cruz", "Home St");
        var command = Create(product, customer, "  9 Offline Rd ", OrderStatusEnum.Completed) with
        {
            OfflineLocalId = "local-address-1",
            PaymentMethod = PaymentMethodEnum.Cash,
            AmountReceived = 100m,
        };

        var results = await SyncHandler().Handle(new SyncOfflineOrdersCommand([command]), CancellationToken.None);

        results.Single().Error.ShouldBeNull();
        (await SavedAddress(results.Single().OrderId!.Value)).ShouldBe("9 Offline Rd");
    }

    [Fact]
    public async Task OfflineSync_NoAddressTyped_FallsBackToTheCustomersSavedAddress()
    {
        var product = _data.AddProduct("Latte", 100);
        var customer = AddCustomer("Ana", "Cruz", "Home St");
        var command = Create(product, customer, null, OrderStatusEnum.Completed) with
        {
            OfflineLocalId = "local-address-2",
            PaymentMethod = PaymentMethodEnum.Cash,
            AmountReceived = 100m,
        };

        var results = await SyncHandler().Handle(new SyncOfflineOrdersCommand([command]), CancellationToken.None);

        (await SavedAddress(results.Single().OrderId!.Value)).ShouldBe("Home St");
    }

    [Theory]
    [InlineData(OrderStatusEnum.Pending, OrderStatusEnum.Cancelled)]
    [InlineData(OrderStatusEnum.Completed, OrderStatusEnum.Refunded)]
    public async Task Void_KeepsTheOrdersAddressAndShowsItOnTheResult(OrderStatusEnum before, OrderStatusEnum after)
    {
        var product = _data.AddProduct("Latte", 100);
        var customer = AddCustomer("Ana", "Cruz", "Home St");
        var command = Create(product, customer, "5 Void Ave", before) with { PaymentMethod = PaymentMethodEnum.Cash, AmountReceived = 100m };
        var order = await Creator().Handle(command, CancellationToken.None);
        var voider = new VoidOrderHandler(_data.Open(), TestRequest.As(_userId, AppRoles.Admin), TestFakes.Hub(), _audit, TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(_data.Open()));

        var result = await voider.Handle(new VoidOrderCommand(order.Id, "customer changed their mind"), CancellationToken.None);

        result!.Status.ShouldBe(after);
        result.CustomerAddress.ShouldBe("5 Void Ave");
        (await SavedAddress(order.Id)).ShouldBe("5 Void Ave");
    }

    private SyncOfflineOrdersHandler SyncHandler()
    {
        var db = _data.Open();
        var accessor = TestRequest.As(_userId, AppRoles.Admin);
        var create = TestFakes.CreateOrderHandler(db, accessor, _audit);
        var sender = Substitute.For<ISender>();
        sender.Send(Arg.Any<CreateOrderCommand>(), Arg.Any<CancellationToken>())
            .Returns(call => create.Handle(call.Arg<CreateOrderCommand>(), call.Arg<CancellationToken>()));
        return new SyncOfflineOrdersHandler(db, sender, accessor, TestFakes.Features);
    }
}
