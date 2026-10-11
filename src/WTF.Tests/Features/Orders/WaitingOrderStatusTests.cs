using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Dashboard;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Products;
using WTF.Api.Features.Products.DTOs;
using WTF.Api.Features.Products.Enums;
using WTF.Domain.Entities;
using WTF.Tests.Features.Products;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Orders;

/// <summary>
/// Orders a customer placed through their link wait for approval (status PendingApproval) and must not behave like
/// ordinary open orders: not in the normal lists, not editable, not voidable, not creatable by staff, not in the
/// dashboard. These tests pin each place that treats "not completed" as "open".
/// </summary>
public class WaitingOrderStatusTests
{
    private readonly Guid _userId = Guid.NewGuid();
    private readonly OrderSeed _data = new(TestDb.NewName());

    private Guid AddWaiting(DateTime? createdAt = null, int? orderNumber = null, Guid? customerId = null)
    {
        var id = _data.AddOrder(OrderStatusEnum.PendingApproval, customerId, createdAt, orderNumber);
        using var db = _data.Open();
        var order = db.Orders.Single(o => o.Id == id);
        order.Source = (byte)OrderSourceEnum.CustomerLink;
        order.FulfillmentType = (byte)FulfillmentTypeEnum.Delivery;
        order.DeliveryAddress = "5 Side St";
        order.ContactNumber = "0917 123 4567";
        db.SaveChanges();
        return id;
    }

    // --- lists ---

    [Fact]
    public async Task PagedList_AllAndExcludeFinalized_LeaveOutWaitingOrders()
    {
        var open = _data.AddOrder(OrderStatusEnum.Pending);
        _data.AddOrder(OrderStatusEnum.Cancelled);
        AddWaiting();

        var all = await new GetPagedOrdersHandler(_data.Open())
            .Handle(new GetPagedOrdersQuery(), CancellationToken.None);
        var active = await new GetPagedOrdersHandler(_data.Open())
            .Handle(new GetPagedOrdersQuery(ExcludeFinalized: true), CancellationToken.None);

        all.TotalCount.ShouldBe(2);
        all.Items.ShouldAllBe(o => o.Status != OrderStatusEnum.PendingApproval);
        active.Items.ShouldAllBe(o => o.Status != OrderStatusEnum.PendingApproval);
        active.Items.Select(o => o.Id).ShouldContain(open);
    }

    [Fact]
    public async Task PagedList_WaitingOrdersAreReturnedWhenAskedForByStatus()
    {
        _data.AddOrder(OrderStatusEnum.Pending);
        var waiting = AddWaiting();

        var result = await new GetPagedOrdersHandler(_data.Open())
            .Handle(new GetPagedOrdersQuery(Status: OrderStatusEnum.PendingApproval), CancellationToken.None);

        result.Items.ShouldHaveSingleItem().Id.ShouldBe(waiting);
        result.TotalCount.ShouldBe(1);
    }

    [Fact]
    public async Task PagedList_SearchingDoesNotBringWaitingOrdersIntoTheNormalList()
    {
        var customer = _data.AddCustomer("Maria", "Cruz");
        AddWaiting(customerId: customer);

        var result = await new GetPagedOrdersHandler(_data.Open())
            .Handle(new GetPagedOrdersQuery(SearchTerm: "maria"), CancellationToken.None);

        result.Items.ShouldBeEmpty();
    }

    [Fact]
    public async Task PagedList_ShowsHowAnOnlineOrderIsHandedOver()
    {
        var waiting = AddWaiting();

        var dto = (await new GetPagedOrdersHandler(_data.Open())
            .Handle(new GetPagedOrdersQuery(Status: OrderStatusEnum.PendingApproval), CancellationToken.None)).Items.Single();

        dto.Id.ShouldBe(waiting);
        dto.Source.ShouldBe(OrderSourceEnum.CustomerLink);
        dto.FulfillmentType.ShouldBe(FulfillmentTypeEnum.Delivery);
        dto.DeliveryAddress.ShouldBe("5 Side St");
        dto.ContactNumber.ShouldBe("0917 123 4567");
    }

    [Fact]
    public async Task List_AllAndActive_LeaveOutWaitingOrders_AndStatusBringsThemBack()
    {
        _data.AddOrder(OrderStatusEnum.Pending);
        var waiting = AddWaiting();

        var all = await new GetOrdersHandler(_data.Open()).Handle(new GetOrdersQuery(), CancellationToken.None);
        var active = await new GetOrdersHandler(_data.Open())
            .Handle(new GetOrdersQuery(ExcludeFinalized: true), CancellationToken.None);
        var onlyWaiting = await new GetOrdersHandler(_data.Open())
            .Handle(new GetOrdersQuery(Status: OrderStatusEnum.PendingApproval), CancellationToken.None);

        all.ShouldAllBe(o => o.Status != OrderStatusEnum.PendingApproval);
        active.ShouldAllBe(o => o.Status != OrderStatusEnum.PendingApproval);
        onlyWaiting.ShouldHaveSingleItem().Id.ShouldBe(waiting);
        onlyWaiting[0].ContactNumber.ShouldBe("0917 123 4567");
    }

    [Fact]
    public async Task OrderById_ReturnsTheOnlineOrderDetailsAndTheRejectionReason()
    {
        var waiting = AddWaiting();
        await using (var db = _data.Open())
        {
            var order = await db.Orders.SingleAsync();
            order.StatusId = (int)OrderStatusEnum.Cancelled;
            order.RejectionReason = "Closed";
            await db.SaveChangesAsync();
        }

        var dto = await new GetOrderByIdHandler(_data.Open()).Handle(new GetOrderByIdQuery(waiting), CancellationToken.None);

        dto!.Source.ShouldBe(OrderSourceEnum.CustomerLink);
        dto.FulfillmentType.ShouldBe(FulfillmentTypeEnum.Delivery);
        dto.DeliveryAddress.ShouldBe("5 Side St");
        dto.RejectionReason.ShouldBe("Closed");
    }

    [Fact]
    public async Task OrderById_AnOrdinaryOrderIsAPosOrderWithNoOnlineDetails()
    {
        var id = _data.AddOrder();

        var dto = await new GetOrderByIdHandler(_data.Open()).Handle(new GetOrderByIdQuery(id), CancellationToken.None);

        dto!.Source.ShouldBe(OrderSourceEnum.Pos);
        dto.FulfillmentType.ShouldBeNull();
        dto.DeliveryAddress.ShouldBeNull();
        dto.ContactNumber.ShouldBeNull();
        dto.RejectionReason.ShouldBeNull();
    }

    // --- changes ---

    [Fact]
    public async Task Void_AWaitingOrder_IsRefusedWithAPointerToAcceptOrReject()
    {
        var waiting = AddWaiting();
        var handler = new VoidOrderHandler(
            _data.Open(), TestRequest.As(_userId, AppRoles.Admin), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push());

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            handler.Handle(new VoidOrderCommand(waiting, "x"), CancellationToken.None));

        ex.Message.ShouldContain("Accept or reject");
        await using var db = _data.Open();
        (await db.Orders.SingleAsync()).StatusId.ShouldBe((int)OrderStatusEnum.PendingApproval);
    }

    private UpdateOrderHandler UpdateHandler() =>
        new(_data.Open(), TestRequest.As(_userId, AppRoles.Admin), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push());

    private static UpdateOrderCommand Update(Guid id, OrderStatusEnum status, Guid productId) => new()
    {
        Id = id,
        Items = [new OrderItemRequestDto(productId, 1, [], null, null)],
        Status = status
    };

    [Fact]
    public async Task Update_AWaitingOrder_CannotBeEditedFromThePos()
    {
        var burger = _data.AddProduct("Burger", 100);
        var waiting = AddWaiting();
        _data.AddLine(waiting, burger);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            UpdateHandler().Handle(Update(waiting, OrderStatusEnum.Pending, burger), CancellationToken.None));

        ex.Message.ShouldContain("waiting for approval");
        await using var db = _data.Open();
        (await db.Orders.SingleAsync()).StatusId.ShouldBe((int)OrderStatusEnum.PendingApproval);
    }

    [Fact]
    public async Task Update_NoOrderCanBeMovedIntoWaitingForApproval()
    {
        var burger = _data.AddProduct("Burger", 100);
        var open = _data.AddOrder();
        _data.AddLine(open, burger);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            UpdateHandler().Handle(Update(open, OrderStatusEnum.PendingApproval, burger), CancellationToken.None));

        ex.Message.ShouldContain("cannot be set to waiting for approval");
        await using var db = _data.Open();
        (await db.Orders.SingleAsync()).StatusId.ShouldBe((int)OrderStatusEnum.Pending);
    }

    [Fact]
    public async Task Create_StaffCannotCreateAnOrderAsWaitingForApproval()
    {
        var burger = _data.AddProduct("Burger", 100);
        var handler = new CreateOrderHandler(
            _data.Open(), TestRequest.As(_userId, AppRoles.Cashier), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push());

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => handler.Handle(
            new CreateOrderCommand
            {
                Items = [new OrderItemRequestDto(burger, 1, [], null, null)],
                Status = OrderStatusEnum.PendingApproval
            }, CancellationToken.None));

        ex.Message.ShouldContain("waiting for approval");
        await using var db = _data.Open();
        (await db.Orders.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public void Create_ServerOnlyFieldsCanNotBeSetFromARequestBody()
    {
        var json = $$"""
            {
              "items": [],
              "status": 1,
              "actorUserId": "{{Guid.NewGuid()}}",
              "source": 1,
              "orderLinkId": "{{Guid.NewGuid()}}",
              "fulfillmentType": 1,
              "deliveryAddress": "elsewhere",
              "contactNumber": "0999"
            }
            """;

        var command = JsonSerializer.Deserialize<CreateOrderCommand>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

        command.ActorUserId.ShouldBeNull();
        command.Source.ShouldBe(OrderSourceEnum.Pos);
        command.OrderLinkId.ShouldBeNull();
        command.FulfillmentType.ShouldBeNull();
        command.DeliveryAddress.ShouldBeNull();
        command.ContactNumber.ShouldBeNull();
    }

    [Fact]
    public async Task Create_ForALinkOrder_UsesTheGivenUserNotTheSignedInOne()
    {
        var burger = _data.AddProduct("Burger", 100);
        var systemUser = Guid.NewGuid();
        var push = TestFakes.Push();
        var handler = new CreateOrderHandler(
            _data.Open(), TestRequest.None(), TestFakes.Hub(), TestFakes.Audit(), push);

        await handler.Handle(new CreateOrderCommand
        {
            Items = [new OrderItemRequestDto(burger, 1, [], null, null)],
            Status = OrderStatusEnum.PendingApproval,
            ActorUserId = systemUser,
            Source = OrderSourceEnum.CustomerLink
        }, CancellationToken.None);

        await using var db = _data.Open();
        (await db.Orders.SingleAsync()).CreatedBy.ShouldBe(systemUser);
    }

    [Fact]
    public async Task Create_ForAPosOrder_StillSendsTheUsualCreatedNotification()
    {
        var burger = _data.AddProduct("Burger", 100);
        var push = TestFakes.Push();
        var handler = new CreateOrderHandler(
            _data.Open(), TestRequest.As(_userId, AppRoles.Cashier), TestFakes.Hub(), TestFakes.Audit(), push);

        await handler.Handle(new CreateOrderCommand
        {
            Items = [new OrderItemRequestDto(burger, 1, [], null, null)],
            Status = OrderStatusEnum.Pending
        }, CancellationToken.None);

        await push.Received(1).SendOrderCreatedAsync(Arg.Any<Order>(), Arg.Any<decimal>(), _userId, Arg.Any<CancellationToken>());
        await push.DidNotReceiveWithAnyArgs().SendLinkOrderCreatedAsync(default!, default, default, default, default);
    }

    // --- dashboard and add-on links ---

    [Fact]
    public async Task Dashboard_RecentOrdersLeaveOutWaitingOrders_AndTheyAreNotCountedAnywhere()
    {
        await using (var seed = _data.Open())
        {
            seed.Statuses.AddRange(
                new Status { Id = 1, Name = "Pending" }, new Status { Id = 2, Name = "Completed" },
                new Status { Id = 3, Name = "Cancelled" }, new Status { Id = 4, Name = "Refunded" },
                new Status { Id = 5, Name = "PendingApproval" });
            await seed.SaveChangesAsync();
        }

        var burger = _data.AddProduct("Burger", 100);
        var now = DateTime.UtcNow.AddMinutes(-1);
        var done = _data.AddOrder(OrderStatusEnum.Completed, createdAt: now);
        _data.AddLine(done, burger, 1, price: 100);
        var waiting = AddWaiting(createdAt: now);
        _data.AddLine(waiting, burger, 5);

        var dto = await new GetDashboardHandler(_data.Open(), TestRequest.As(_userId, timeZone: "UTC"))
            .Handle(new GetDashboardQuery("last30days", null, null), CancellationToken.None);

        dto.RecentOrders.Select(o => o.Id).ShouldBe([done]);
        dto.OrdersByStatus.Completed.ShouldBe(1);
        dto.OrdersByStatus.Pending.ShouldBe(0);
        dto.OrdersByStatus.Cancelled.ShouldBe(0);
        dto.OrdersByStatus.Refunded.ShouldBe(0);
        dto.TopSellingProducts.Sum(p => p.QuantitySold).ShouldBe(1);
    }

    [Fact]
    public async Task UnlinkingAnAddOn_AlsoDetachesItFromOrdersStillWaitingForApproval()
    {
        var product = ProductSeed.NewProduct();
        var shot = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        var waiting = new Order { Id = Guid.NewGuid(), StatusId = (int)OrderStatusEnum.PendingApproval };
        var parent = new OrderItem { Id = Guid.NewGuid(), OrderId = waiting.Id, ProductId = product.Id, Quantity = 1 };
        var child = new OrderItem { Id = Guid.NewGuid(), OrderId = waiting.Id, ProductId = shot.Id, Quantity = 1, ParentOrderItemId = parent.Id };
        var dbName = TestDb.NewName();
        await ProductSeed.SeedAsync(dbName, product, shot, ProductSeed.NewLink(product.Id, shot.Id), waiting, parent, child);

        await new AssignProductAddOnsHandler(TestDb.Create(dbName)).Handle(
            new AssignProductAddOnsCommand { ProductId = product.Id, AddOns = [] }, CancellationToken.None);

        await using var db = TestDb.Create(dbName);
        (await db.OrderItems.SingleAsync(i => i.Id == child.Id)).ParentOrderItemId.ShouldBeNull();
    }
}
