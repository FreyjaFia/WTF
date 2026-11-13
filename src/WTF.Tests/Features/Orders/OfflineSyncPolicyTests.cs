using MediatR;
using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Features.Customers;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Orders;

public class OfflineSyncPolicyTests
{
    private static readonly DateTime Sold = new(2026, 6, 10, 12, 0, 0, DateTimeKind.Utc);
    private static readonly Guid OtherTenant = Guid.Parse("00000000-0000-0000-0000-0000000000b2");

    private readonly Guid _userId = Guid.NewGuid();
    private readonly Guid _tenantId = TenantDefaults.DefaultTenantId;
    private readonly string _dbName = TestDb.NewName();
    private readonly IAuditService _audit = TestFakes.Audit();

    [Fact]
    public async Task NoPolicyRow_BehavesAsToday()
    {
        var latte = await SeedProductAsync("Latte", 153m);

        var result = await SyncAsync(Order("P-1", Line(latte, 150m)));

        result.Status.ShouldBe(OrderStatusEnum.PendingReview);
        result.ReasonDetails!.Single().Severity.ShouldBe("Hold");
    }

    [Fact]
    public async Task ZeroTolerance_HoldsAThreePesoDifference()
    {
        var latte = await SeedProductAsync("Latte", 153m);
        await SavePolicyAsync(p => p.PriceTolerance = 0m);

        var result = await SyncAsync(Order("P-2", Line(latte, 150m)));

        result.Status.ShouldBe(OrderStatusEnum.PendingReview);
    }

    [Fact]
    public async Task Tolerance5_TurnsAThreePesoDifferenceIntoANote_AndSavesAtTheQuotedPrice()
    {
        var latte = await SeedProductAsync("Latte", 153m);
        await SavePolicyAsync(p => p.PriceTolerance = 5m);

        var result = await SyncAsync(Order("P-3", Line(latte, 150m)));

        result.Status.ShouldBe(OrderStatusEnum.Completed);
        var reason = result.ReasonDetails!.Single();
        reason.Code.ShouldBe(OfflineReasonCodes.PriceChanged);
        reason.Severity.ShouldBe("Note");
        (await OrderTotalAsync(result.OrderId!.Value)).ShouldBe(150m);
    }

    [Fact]
    public async Task Tolerance5_StillHoldsASixPesoDifference()
    {
        var latte = await SeedProductAsync("Latte", 156m);
        await SavePolicyAsync(p => p.PriceTolerance = 5m);

        var result = await SyncAsync(Order("P-4", Line(latte, 150m)));

        result.Status.ShouldBe(OrderStatusEnum.PendingReview);
        result.ReasonDetails!.Single().Severity.ShouldBe("Hold");
    }

    [Fact]
    public async Task Tolerance_AppliesToAnAddOnPrice()
    {
        var latte = await SeedProductAsync("Latte", 150m);
        var oat = await SeedProductAsync("Oat Milk", 33m, addOn: true);
        await SavePolicyAsync(p => p.PriceTolerance = 5m);

        var result = await SyncAsync(Order("P-5", Line(latte, 150m, (oat, 30m))));

        result.Status.ShouldBe(OrderStatusEnum.Completed);
        result.ReasonDetails!.Single().Code.ShouldBe(OfflineReasonCodes.AddOnPriceChanged);
    }

    [Fact]
    public async Task APerCodeNoteMode_LetsThatCodeThroughButNotTheOthers()
    {
        var latte = await SeedProductAsync("Latte", 150m, active: false);
        await SavePolicyAsync(p => p.CustomerInactiveMode = (byte)ReviewSeverityEnum.Note);

        var held = await SyncAsync(Order("P-6", Line(latte, 150m)));
        held.Status.ShouldBe(OrderStatusEnum.PendingReview);

        var active = await SeedProductAsync("Mocha", 150m);
        var customer = await SeedCustomerAsync(isActive: false);
        var passed = await SyncAsync(Order("P-7", Line(active, 150m)) with { CustomerId = customer });
        passed.Status.ShouldBe(OrderStatusEnum.Completed);
        passed.ReasonDetails!.Single().Code.ShouldBe(OfflineReasonCodes.CustomerInactive);
    }

    [Fact]
    public async Task AProductInactiveNoteMode_SavesTheSaleCompleted()
    {
        var latte = await SeedProductAsync("Latte", 150m, active: false);
        await SavePolicyAsync(p => p.ProductInactiveMode = (byte)ReviewSeverityEnum.Note);

        var result = await SyncAsync(Order("P-8", Line(latte, 150m)));

        result.Status.ShouldBe(OrderStatusEnum.Completed);
    }

    [Fact]
    public async Task SeniorPwdCodes_IgnoreEveryPolicySetting()
    {
        var reasons = new[]
        {
            OfflineReason.Hold(OfflineReasonCodes.SeniorPwdSettingsChanged, "x", null, "1.00", "9.00", 8m),
            OfflineReason.Hold(OfflineReasonCodes.SeniorPwdDisabled, "x"),
            OfflineReason.Hold(OfflineReasonCodes.SeniorPwdIdMissing, "x"),
            OfflineReason.Hold(OfflineReasonCodes.SeniorPwdOnPromotion, "x"),
            OfflineReason.Note(OfflineReasonCodes.SeniorPwdIdRepeated, "x")
        };
        await SavePolicyAsync(p =>
        {
            p.PriceTolerance = 1000m;
            p.AutoApproveNotes = true;
            p.PriceChangedMode = (byte)ReviewSeverityEnum.Note;
        });
        await using var db = TestDb.Create(_dbName, new FixedTenant(_tenantId));
        var policy = await OfflineSyncPolicyStore.LoadSnapshotAsync(db, CancellationToken.None);

        var judged = OfflineOrderReview.ApplyPolicy(reasons, policy);

        judged.Select(r => r.Severity).ShouldBe(
            [ReviewSeverityEnum.Hold, ReviewSeverityEnum.Hold, ReviewSeverityEnum.Hold, ReviewSeverityEnum.Hold, ReviewSeverityEnum.Note]);
    }

    [Fact]
    public async Task AutoApproveOff_NotesAreSavedWithoutAnAutoApprovalAudit()
    {
        var latte = await SeedProductAsync("Latte", 153m);
        await SavePolicyAsync(p => p.PriceTolerance = 5m);

        await SyncAsync(Order("P-9", Line(latte, 150m)));

        await _audit.DidNotReceive().LogAsync(
            AuditAction.OfflineOrderAutoApproved, Arg.Any<AuditEntityType>(), Arg.Any<string>(), Arg.Any<object?>(), Arg.Any<object?>(), Arg.Any<Guid?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task AutoApproveOn_AuditsASaleSavedWithNotes_AndNotACleanSaleOrAHeldOne()
    {
        var latte = await SeedProductAsync("Latte", 153m);
        var mocha = await SeedProductAsync("Mocha", 150m);
        var tea = await SeedProductAsync("Tea", 190m);
        await SavePolicyAsync(p =>
        {
            p.PriceTolerance = 5m;
            p.AutoApproveNotes = true;
        });

        var withNote = await SyncAsync(Order("P-10", Line(latte, 150m)));
        await SyncAsync(Order("P-11", Line(mocha, 150m)));
        var held = await SyncAsync(Order("P-12", Line(tea, 150m)));

        held.Status.ShouldBe(OrderStatusEnum.PendingReview);
        await _audit.Received(1).LogAsync(
            AuditAction.OfflineOrderAutoApproved,
            AuditEntityType.Order,
            withNote.OrderId!.Value.ToString(),
            Arg.Any<object?>(),
            Arg.Any<object?>(),
            Arg.Any<Guid?>(),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task APolicyOfAnotherShop_IsNeverApplied()
    {
        var latte = await SeedProductAsync("Latte", 153m);
        await using (var other = TestDb.Create(_dbName, new FixedTenant(OtherTenant)))
        {
            other.OfflineSyncPolicies.Add(new OfflineSyncPolicy { TenantId = OtherTenant, PriceTolerance = 1000m, PriceChangedMode = 1, AgedAfterDays = 2 });
            await other.SaveChangesAsync();
        }

        var result = await SyncAsync(Order("P-13", Line(latte, 150m)));

        result.Status.ShouldBe(OrderStatusEnum.PendingReview);
    }

    private static CreateOrderCommand Order(string localId, OrderItemRequestDto line) =>
        new()
        {
            Status = OrderStatusEnum.Completed,
            Items = [line],
            OfflineLocalId = localId,
            CreatedAt = Sold,
            PaymentMethod = PaymentMethodEnum.Cash,
            AmountReceived = 1000m,
        };

    private static OrderItemRequestDto Line(Guid productId, decimal quoted, (Guid Id, decimal Price)? addOn = null) =>
        new(productId, 1, addOn is null ? [] : [new OrderItemRequestDto(addOn.Value.Id, 1, [], null, null, addOn.Value.Price)], null, null, quoted);

    private async Task<OfflineSyncResultDto> SyncAsync(CreateOrderCommand order)
    {
        var db = TestDb.Create(_dbName, new FixedTenant(_tenantId));
        var accessor = TestRequest.As(_userId, AppRoles.Admin);
        var create = new CreateOrderHandler(db, accessor, TestFakes.Hub(), _audit, TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(db));
        var sender = Substitute.For<ISender>();
        sender.Send(Arg.Any<CreateOrderCommand>(), Arg.Any<CancellationToken>())
            .Returns(call => create.Handle(call.Arg<CreateOrderCommand>(), call.Arg<CancellationToken>()));
        var results = await new SyncOfflineOrdersHandler(db, sender, accessor).Handle(new SyncOfflineOrdersCommand([order]), CancellationToken.None);
        return results.Single();
    }

    private async Task<decimal> OrderTotalAsync(Guid orderId)
    {
        await using var db = TestDb.Create(_dbName, new FixedTenant(_tenantId));
        var order = await db.Orders.Include(o => o.OrderItems).SingleAsync(o => o.Id == orderId);
        return order.OrderItems.Sum(i => (i.Price ?? 0m) * i.Quantity);
    }

    private async Task SavePolicyAsync(Action<OfflineSyncPolicy> change)
    {
        await using var db = TestDb.Create(_dbName, new FixedTenant(_tenantId));
        var policy = new OfflineSyncPolicy
        {
            TenantId = _tenantId,
            PriceChangedMode = 1,
            AddOnPriceChangedMode = 1,
            ProductInactiveMode = 1,
            BundleChangedMode = 1,
            CustomerInactiveMode = 1,
            PromotionEndedMode = 1,
            UnknownProductMode = 1,
            AgedAfterDays = 2,
        };
        change(policy);
        db.OfflineSyncPolicies.Add(policy);
        await db.SaveChangesAsync();
    }

    private async Task<Guid> SeedCustomerAsync(bool isActive)
    {
        await using var db = TestDb.Create(_dbName, new FixedTenant(_tenantId));
        var customer = CustomerSeed.NewCustomer(isActive: isActive);
        db.Customers.Add(customer);
        await db.SaveChangesAsync();
        return customer.Id;
    }

    private async Task<Guid> SeedProductAsync(string name, decimal price, bool active = true, bool addOn = false)
    {
        await using var db = TestDb.Create(_dbName, new FixedTenant(_tenantId));
        var product = new Product { Id = Guid.NewGuid(), Name = name, Price = price, IsActive = active, IsAddOn = addOn, Code = name, CreatedAt = Sold, CreatedBy = _userId };
        db.Products.Add(product);
        await db.SaveChangesAsync();
        return product.Id;
    }

    private sealed class FixedTenant(Guid id) : ICurrentTenant
    {
        public bool FilterEnabled => true;

        public Guid? TenantId => id;

        public Guid? StampTenantId => id;
    }
}
