using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Branches;

public class OrderSyncBranchTests
{
    private static readonly Guid Tenant = TenantDefaults.DefaultTenantId;

    private readonly Guid _userId = Guid.NewGuid();
    private readonly string _dbName = TestDb.NewName();
    private readonly Guid _makati;
    private readonly Guid _cebu = Guid.NewGuid();
    private readonly Guid _davao = Guid.NewGuid();
    private readonly Guid _latte = Guid.NewGuid();

    public OrderSyncBranchTests()
    {
        using var db = TestDb.Create(_dbName);
        _makati = db.Branches.Single(b => b.IsMain).Id;
        db.Branches.Add(NewBranch(_cebu, "Cebu", "CEB", true));
        db.Branches.Add(NewBranch(_davao, "Davao", "DAV", false));
        db.Products.Add(new Product { Id = _latte, Name = "Latte", Code = "LATTE", Price = 160m, IsActive = true, CategoryId = 1, CreatedAt = DateTime.UtcNow, CreatedBy = _userId });
        db.SaveChanges();
    }

    private static Branch NewBranch(Guid id, string name, string code, bool active) => new()
    {
        Id = id,
        TenantId = Tenant,
        Name = name,
        Code = code,
        TimeZone = "Asia/Manila",
        IsActive = active,
        CreatedAt = DateTime.UtcNow,
    };

    private WTFDbContext Open(FixedBranch branch) => TestDb.Create(_dbName, NoTenant.Instance, branch);

    private CreateOrderCommand Order(string localId, Guid? branchId = null, DateTime? createdAt = null, DateTime? catalogSyncedAt = null) => new()
    {
        Status = OrderStatusEnum.Completed,
        Items = [new OrderItemRequestDto(_latte, 1, [], null, null, 160m)],
        OfflineLocalId = localId,
        PaymentMethod = PaymentMethodEnum.Cash,
        AmountReceived = 500m,
        ExpectedTotal = 160m,
        BranchId = branchId,
        CreatedAt = createdAt ?? DateTime.UtcNow.AddMinutes(-30),
        CatalogSyncedAt = catalogSyncedAt,
    };

    private ISender SenderFor(WTFDbContext db, IHttpContextAccessor accessor)
    {
        var create = TestFakes.CreateOrderHandler(db, accessor);
        var sender = Substitute.For<ISender>();
        sender.Send(Arg.Any<CreateOrderCommand>(), Arg.Any<CancellationToken>())
            .Returns(call => create.Handle(call.Arg<CreateOrderCommand>(), call.Arg<CancellationToken>()));
        sender.Send(Arg.Any<GetOrderByIdQuery>(), Arg.Any<CancellationToken>())
            .Returns(call => new GetOrderByIdHandler(db, TestFakes.Features, accessor).Handle(call.Arg<GetOrderByIdQuery>(), call.Arg<CancellationToken>()));
        return sender;
    }

    private async Task<OfflineSyncResultDto> SyncAsync(FixedBranch branch, CreateOrderCommand order)
    {
        await using var db = Open(branch);
        var accessor = TestRequest.As(_userId, AppRoles.Cashier);
        var handler = new SyncOfflineOrdersHandler(db, SenderFor(db, accessor), accessor, TestFakes.Features);
        return (await handler.Handle(new SyncOfflineOrdersCommand([order]), CancellationToken.None)).Single();
    }

    private async Task<List<OrderDto>> BatchAsync(FixedBranch branch, params CreateOrderCommand[] orders)
    {
        await using var db = Open(branch);
        var accessor = TestRequest.As(_userId, AppRoles.Cashier);
        return await new CreateOrderBatchHandler(db, SenderFor(db, accessor)).Handle(new CreateOrderBatchCommand([.. orders]), CancellationToken.None);
    }

    private async Task<List<Order>> SavedOrdersAsync()
    {
        await using var db = TestDb.Create(_dbName);
        return await db.Orders.AsNoTracking().ToListAsync();
    }

    [Fact]
    public async Task Batch_IgnoresTheBranchTheDeviceNames_AndSavesInTheActiveBranch()
    {
        var foreign = Guid.NewGuid();

        await BatchAsync(new FixedBranch([_makati, _cebu], _cebu, false), Order("B-1", foreign));

        (await SavedOrdersAsync()).Single().BranchId.ShouldBe(_cebu);
    }

    [Fact]
    public async Task Batch_ARetriedOrder_ReturnsTheSavedOneInsteadOfSavingItTwice()
    {
        var branch = new FixedBranch([_makati], _makati, false);

        var first = await BatchAsync(branch, Order("B-2"));
        var again = await BatchAsync(branch, Order("B-2"));

        again.Single().Id.ShouldBe(first.Single().Id);
        (await SavedOrdersAsync()).Count.ShouldBe(1);
    }

    [Fact]
    public async Task Batch_ACatalogTimeAfterTheOrderTime_IsRefused()
    {
        var sold = DateTime.UtcNow.AddHours(-3);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            BatchAsync(new FixedBranch([_makati], _makati, false), Order("B-3", createdAt: sold, catalogSyncedAt: sold.AddHours(1))));
        (await SavedOrdersAsync()).ShouldBeEmpty();
    }

    [Fact]
    public async Task Sync_ASaleMadeInABranchThatClosedSince_StaysThereWithANote()
    {
        var result = await SyncAsync(new FixedBranch([_makati, _cebu, _davao], _makati, false), Order("S-1", _davao));

        result.Error.ShouldBeNull();
        (await SavedOrdersAsync()).Single().BranchId.ShouldBe(_davao);
        result.ReasonDetails!.Single().Code.ShouldBe(OfflineReasonCodes.BranchClosed);
        result.Status.ShouldBe(OrderStatusEnum.Completed);
    }

    [Fact]
    public async Task Sync_ABranchThatDoesNotExist_StillFallsBackToTheActiveBranch()
    {
        var result = await SyncAsync(new FixedBranch([_makati, _cebu], _cebu, false), Order("S-2", Guid.NewGuid()));

        result.Error.ShouldBeNull();
        (await SavedOrdersAsync()).Single().BranchId.ShouldBe(_cebu);
    }

    [Fact]
    public async Task Sync_ABranchThePersonMayNotUse_IsRefusedAndNotMovedToTheirOwnBranch()
    {
        var result = await SyncAsync(new FixedBranch([_makati], _makati, true), Order("S-3", _cebu));

        result.Error.ShouldNotBeNull();
        (await SavedOrdersAsync()).ShouldBeEmpty();
    }

    [Fact]
    public async Task Sync_AnOrderTimedInTheFuture_IsRefused()
    {
        var result = await SyncAsync(new FixedBranch([_makati], _makati, false), Order("S-4", createdAt: DateTime.UtcNow.AddHours(2)));

        result.Error.ShouldNotBeNull();
        (await SavedOrdersAsync()).ShouldBeEmpty();
    }

    [Fact]
    public async Task Sync_AnOrderOlderThanTheWindow_IsRefusedEvenWhenTheSubscriptionIsActive()
    {
        var result = await SyncAsync(new FixedBranch([_makati], _makati, false), Order("S-5", createdAt: DateTime.UtcNow.AddDays(-30)));

        result.Error.ShouldNotBeNull();
        (await SavedOrdersAsync()).ShouldBeEmpty();
    }

    [Fact]
    public async Task Sync_ACatalogTimeAfterTheOrderTime_IsRefused()
    {
        var sold = DateTime.UtcNow.AddHours(-3);

        var result = await SyncAsync(new FixedBranch([_makati], _makati, false), Order("S-6", createdAt: sold, catalogSyncedAt: sold.AddHours(1)));

        result.Error.ShouldNotBeNull();
        (await SavedOrdersAsync()).ShouldBeEmpty();
    }
}
