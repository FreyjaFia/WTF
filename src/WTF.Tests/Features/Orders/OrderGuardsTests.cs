using MediatR;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Orders;

public class OrderGuardsTests
{
    private static readonly DateTime Now = new(2026, 6, 10, 12, 0, 0, DateTimeKind.Utc);

    private readonly Guid _userId = Guid.NewGuid();
    private readonly string _dbName = TestDb.NewName();
    private readonly OrderSeed _data;

    public OrderGuardsTests()
    {
        _data = new OrderSeed(_dbName);
    }

    private static SeniorPwdPersonRequestDto Person(string id = "SC-123456") => new(SeniorPwdTypeEnum.Senior, id, "Lola Remedios");

    private static CreateOrderCommand QueuedSale(Guid productId, params SeniorPwdPersonRequestDto[] persons) => new()
    {
        Status = OrderStatusEnum.Completed,
        Items = [new OrderItemRequestDto(productId, 1, [], null, null, QuotedPrice: 100m, SeniorPwdPersonIndex: 0)],
        SeniorPwdPersons = [.. persons],
        ExpectedTotal = 80m,
    };

    private async Task ConfigureShopAsync(bool vatRegistered = false)
    {
        await using var db = TestDb.Create(_dbName);
        db.TenantSettings.RemoveRange(db.TenantSettings);
        db.TenantSettings.Add(new TenantSetting
        {
            TenantId = Guid.NewGuid(),
            ShopName = "Shop",
            PrimaryColor = "#6f4e37",
            TimeZone = "Asia/Manila",
            CurrencySymbol = "P",
            CurrencyCode = "PHP",
            CurrencyDecimals = 2,
            SeniorPwdEnabled = true,
            VatRegistered = vatRegistered,
        });
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Update_CoveredLineWithAnAddOn_ChecksTheSameAmountItStores()
    {
        await ConfigureShopAsync(vatRegistered: true);
        var latte = _data.AddProduct("Latte", 100m);
        var shot = _data.AddProduct("Shot", 10m, isAddOn: true);
        _data.AllowAddOn(latte, shot);
        var covered = new OrderItemRequestDto(latte, 1, [new OrderItemRequestDto(shot, 1, [], null, null)], null, null, SeniorPwdPersonIndex: 0);
        var create = new CreateOrderHandler(
            TestDb.Create(_dbName), TestRequest.As(_userId, AppRoles.Cashier), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(TestDb.Create(_dbName)), TestFakes.Features);
        var update = new UpdateOrderHandler(
            TestDb.Create(_dbName), TestRequest.As(_userId, AppRoles.Admin), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(TestDb.Create(_dbName)), TestFakes.Features);
        var created = await create.Handle(
            new CreateOrderCommand { Status = OrderStatusEnum.Pending, Items = [covered], SeniorPwdPersons = [Person()] }, CancellationToken.None);

        // 110.00 covered: VAT 11.79 off, then 20% of 98.21 = 19.64 off, so 78.57 is due.
        var completed = await update.Handle(
            new UpdateOrderCommand
            {
                Id = created.Id,
                Status = OrderStatusEnum.Completed,
                Items = [covered],
                SeniorPwdPersons = [Person()],
                ExpectedTotal = 78.57m,
            },
            CancellationToken.None);

        completed!.TotalAmount.ShouldBe(78.57m);
        var person = completed.SeniorPwdPersons.ShouldHaveSingleItem();
        person.CoveredAmount.ShouldBe(110m);
        person.VatExemptAmount.ShouldBe(11.79m);
        person.DiscountAmount.ShouldBe(19.64m);
    }

    [Fact]
    public async Task HeldOrder_FromAUserWithoutTheSeniorPwdPermission_GetsAReviewReason()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);
        await using var db = TestDb.Create(_dbName);

        var reasons = await OfflineOrderReview.FindReasonsAsync(
            db, QueuedSale(latte, Person()), TimeZoneInfo.Utc, CancellationToken.None, TestRequest.As(_userId, "NoPermissions"));

        reasons.ShouldContain(r => r.Contains("without the permission"));
    }

    [Fact]
    public async Task HeldOrder_FromACashier_GetsNoPermissionReason()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);
        await using var db = TestDb.Create(_dbName);

        var reasons = await OfflineOrderReview.FindReasonsAsync(
            db, QueuedSale(latte, Person()), TimeZoneInfo.Utc, CancellationToken.None, TestRequest.As(_userId, AppRoles.Cashier));

        reasons.ShouldBeEmpty();
    }

    [Fact]
    public async Task HeldOrder_WithTheSameIdTwice_GetsAReviewReason()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);
        await using var db = TestDb.Create(_dbName);

        var reasons = await OfflineOrderReview.FindReasonsAsync(
            db, QueuedSale(latte, Person("SC-1"), Person(" sc-1 ")), TimeZoneInfo.Utc, CancellationToken.None, TestRequest.As(_userId, AppRoles.Cashier));

        reasons.ShouldContain(r => r.Contains("more than once"));
    }

    [Fact]
    public void OnlineCreate_AcceptsNoTime_AndATimeAboutNow()
    {
        OfflineSyncWindow.CheckOnlineCreate(null, null, Now).ShouldBeNull();
        OfflineSyncWindow.CheckOnlineCreate(null, Now.AddMinutes(-2), Now).ShouldBeNull();
        OfflineSyncWindow.CheckOnlineCreate(null, Now.AddMinutes(2), Now).ShouldBeNull();
    }

    [Fact]
    public void OnlineCreate_RefusesABackdatedOrFutureTime()
    {
        OfflineSyncWindow.CheckOnlineCreate(null, Now.AddHours(-3), Now).ShouldNotBeNull();
        OfflineSyncWindow.CheckOnlineCreate(null, Now.AddDays(-1), Now).ShouldNotBeNull();
        OfflineSyncWindow.CheckOnlineCreate(null, Now.AddHours(1), Now).ShouldNotBeNull();
    }

    [Fact]
    public async Task Batch_RefusesAFutureTime()
    {
        var sender = Substitute.For<ISender>();
        var handler = new CreateOrderBatchHandler(TestDb.Create(_dbName), sender);
        var latte = _data.AddProduct("Latte", 100m);
        CreateOrderCommand Sale(DateTime? at) => new()
        {
            Status = OrderStatusEnum.Completed,
            Items = [new OrderItemRequestDto(latte, 1, [], null, null)],
            CreatedAt = at,
        };

        await Should.ThrowAsync<InvalidOperationException>(
            handler.Handle(new CreateOrderBatchCommand([Sale(DateTime.UtcNow.AddDays(2))]), CancellationToken.None));
        await sender.DidNotReceiveWithAnyArgs().Send(default(CreateOrderCommand)!, default);
    }
}
