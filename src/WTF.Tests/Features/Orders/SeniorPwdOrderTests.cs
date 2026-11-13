using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Orders;

public class SeniorPwdOrderTests
{
    private readonly Guid _userId = Guid.NewGuid();
    private readonly string _dbName = TestDb.NewName();
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly OrderSeed _data;

    public SeniorPwdOrderTests()
    {
        _data = new OrderSeed(_dbName);
    }

    private CreateOrderHandler CreateHandler(string role = AppRoles.Cashier) =>
        new(TestDb.Create(_dbName), TestRequest.As(_userId, role), TestFakes.Hub(), _audit, TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(TestDb.Create(_dbName)));

    private UpdateOrderHandler UpdateHandler(string role = AppRoles.Admin) =>
        new(TestDb.Create(_dbName), TestRequest.As(_userId, role), TestFakes.Hub(), _audit, TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(TestDb.Create(_dbName)));

    private static SeniorPwdPersonRequestDto Person(string id = "SC-123456", string name = "Lola Remedios", SeniorPwdTypeEnum type = SeniorPwdTypeEnum.Senior) =>
        new(type, id, name);

    private static OrderItemRequestDto Covered(Guid productId, int quantity = 1, int person = 0) =>
        new(productId, quantity, [], null, null, SeniorPwdPersonIndex: person);

    private static OrderItemRequestDto Plain(Guid productId, int quantity = 1) =>
        new(productId, quantity, [], null, null);

    private static CreateOrderCommand Sale(
        IEnumerable<OrderItemRequestDto> items,
        IEnumerable<SeniorPwdPersonRequestDto> persons,
        decimal? expectedTotal = null,
        OrderStatusEnum status = OrderStatusEnum.Completed) =>
        new() { Status = status, Items = [.. items], SeniorPwdPersons = [.. persons], ExpectedTotal = expectedTotal };

    private async Task ConfigureShopAsync(bool enabled = true, bool vatRegistered = false)
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
            SeniorPwdEnabled = enabled,
            VatRegistered = vatRegistered,
        });
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Create_NotVatRegistered_TakesTwentyPercentOffTheCoveredItem()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);

        var dto = await CreateHandler().Handle(Sale([Covered(latte)], [Person()], expectedTotal: 80m), CancellationToken.None);

        dto.TotalAmount.ShouldBe(80m);
        var person = dto.SeniorPwdPersons.ShouldHaveSingleItem();
        person.CoveredAmount.ShouldBe(100m);
        person.VatExemptAmount.ShouldBe(0m);
        person.DiscountAmount.ShouldBe(20m);
        person.IdNumber.ShouldBe("SC-123456");
        var line = dto.Items.ShouldHaveSingleItem();
        line.Price.ShouldBe(100m);
        line.SeniorPwdPersonId.ShouldBe(person.Id);
        line.SeniorPwdDiscount.ShouldBe(20m);
    }

    [Fact]
    public async Task Create_VatRegistered_TakesTheVatOffThenTwentyPercentOfTheRest()
    {
        await ConfigureShopAsync(vatRegistered: true);
        var latte = _data.AddProduct("Latte", 100m);

        var dto = await CreateHandler().Handle(Sale([Covered(latte)], [Person()], expectedTotal: 71.43m), CancellationToken.None);

        dto.TotalAmount.ShouldBe(71.43m);
        var person = dto.SeniorPwdPersons.ShouldHaveSingleItem();
        person.VatExemptAmount.ShouldBe(10.71m);
        person.DiscountAmount.ShouldBe(17.86m);
    }

    [Fact]
    public async Task Create_CoversAddOnsWithTheirItem_ButNotTheOtherLines()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);
        var shot = _data.AddProduct("Shot", 10m, isAddOn: true);
        var cake = _data.AddProduct("Cake", 50m);
        _data.AllowAddOn(latte, shot);
        var withShot = new OrderItemRequestDto(latte, 2, [Plain(shot)], null, null, SeniorPwdPersonIndex: 0);

        var dto = await CreateHandler().Handle(Sale([withShot, Plain(cake)], [Person()], expectedTotal: 226m), CancellationToken.None);

        // Covered: (100 + 10) x 2 = 220, 20% off = 44, plus the cake at 50.
        dto.TotalAmount.ShouldBe(226m);
        dto.SeniorPwdPersons.ShouldHaveSingleItem().CoveredAmount.ShouldBe(220m);
    }

    [Fact]
    public async Task Create_TwoPersons_GetTheirOwnRows()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);
        var cake = _data.AddProduct("Cake", 75.5m);

        var dto = await CreateHandler().Handle(
            Sale([Covered(latte, person: 0), Covered(cake, person: 1)], [Person(), Person("PWD-9", "Mang Jose", SeniorPwdTypeEnum.Pwd)]),
            CancellationToken.None);

        dto.TotalAmount.ShouldBe(140.4m);
        dto.SeniorPwdPersons!.Select(p => p.DiscountAmount).OrderBy(x => x).ToList().ShouldBe([15.1m, 20m]);
    }

    [Fact]
    public async Task Create_WrongExpectedTotal_IsRefused()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);

        // The register forgot the discount: the server works the total out itself.
        var ex = await Should.ThrowAsync<InvalidOperationException>(
            CreateHandler().Handle(Sale([Covered(latte)], [Person()], expectedTotal: 100m), CancellationToken.None));

        ex.Message.ShouldNotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task Create_ShopSwitchOff_IsRefused()
    {
        await ConfigureShopAsync(enabled: false);
        var latte = _data.AddProduct("Latte", 100m);

        var ex = await Should.ThrowAsync<InvalidOperationException>(
            CreateHandler().Handle(Sale([Covered(latte)], [Person()]), CancellationToken.None));

        ex.Message.ShouldContain("turned off");
    }

    [Fact]
    public async Task Create_RoleWithoutThePermission_IsRefused()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);

        var ex = await Should.ThrowAsync<InvalidOperationException>(
            CreateHandler(AppRoles.AdminViewer).Handle(Sale([Covered(latte)], [Person()]), CancellationToken.None));

        ex.Message.ShouldContain("not allowed");
    }

    [Theory]
    [InlineData("", "Lola Remedios")]
    [InlineData("   ", "Lola Remedios")]
    [InlineData("SC-1", "")]
    [InlineData("SC-1", "   ")]
    public async Task Create_BlankIdOrName_IsRefused(string id, string name)
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);

        var ex = await Should.ThrowAsync<InvalidOperationException>(
            CreateHandler().Handle(Sale([Covered(latte)], [Person(id, name)]), CancellationToken.None));

        ex.Message.ShouldContain("ID number");
    }

    [Fact]
    public async Task Create_PersonWithNoCoveredItem_IsRefused()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);

        var ex = await Should.ThrowAsync<InvalidOperationException>(
            CreateHandler().Handle(Sale([Covered(latte, person: 0)], [Person(), Person("SC-2", "Lolo Ben")]), CancellationToken.None));

        ex.Message.ShouldContain("Lolo Ben");
    }

    [Fact]
    public async Task Create_ItemPointingAtAMissingPerson_IsRefused()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);

        await Should.ThrowAsync<InvalidOperationException>(
            CreateHandler().Handle(Sale([Covered(latte, person: 3)], [Person()]), CancellationToken.None));
    }

    [Fact]
    public async Task Create_ProductMarkedNotEligible_IsRefused()
    {
        await ConfigureShopAsync();
        var mug = _data.AddProduct("Mug", 250m);
        await using (var db = TestDb.Create(_dbName))
        {
            (await db.Products.FindAsync(mug))!.IsSeniorPwdEligible = false;
            await db.SaveChangesAsync();
        }

        var ex = await Should.ThrowAsync<InvalidOperationException>(
            CreateHandler().Handle(Sale([Covered(mug)], [Person()]), CancellationToken.None));

        ex.Message.ShouldContain("Mug");
    }

    [Fact]
    public async Task Create_WritesAnAuditEntryWithTheIdMasked()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);

        await CreateHandler().Handle(Sale([Covered(latte)], [Person("SC-123456")]), CancellationToken.None);

        var call = _audit.ReceivedCalls()
            .Where(c => c.GetMethodInfo().Name == nameof(IAuditService.LogAsync))
            .Select(c => c.GetArguments())
            .Single(a => (AuditAction)a[0]! == AuditAction.SeniorPwdDiscountApplied);
        var text = System.Text.Json.JsonSerializer.Serialize(call[4]);
        text.ShouldContain("*****3456");
        text.ShouldNotContain("SC-123456");
    }

    [Fact]
    public async Task Update_PendingOrderThenCompleted_KeepsTheDiscount_AndRemovingItWritesAnAuditEntry()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);
        var created = await CreateHandler().Handle(Sale([Covered(latte)], [Person()], status: OrderStatusEnum.Pending), CancellationToken.None);
        created.TotalAmount.ShouldBe(80m);

        var completed = await UpdateHandler().Handle(
            new UpdateOrderCommand
            {
                Id = created.Id,
                Status = OrderStatusEnum.Completed,
                Items = [Covered(latte)],
                SeniorPwdPersons = [Person()],
                ExpectedTotal = 80m,
            },
            CancellationToken.None);

        completed!.TotalAmount.ShouldBe(80m);
        completed.SeniorPwdPersons.ShouldHaveSingleItem().DiscountAmount.ShouldBe(20m);

        var pending = await CreateHandler().Handle(Sale([Covered(latte)], [Person()], status: OrderStatusEnum.Pending), CancellationToken.None);
        var removed = await UpdateHandler().Handle(
            new UpdateOrderCommand { Id = pending.Id, Status = OrderStatusEnum.Pending, Items = [Plain(latte)] },
            CancellationToken.None);

        removed!.TotalAmount.ShouldBe(100m);
        removed.SeniorPwdPersons.ShouldBeNull();
        await using var db = TestDb.Create(_dbName);
        (await db.OrderSeniorPwdDiscounts.CountAsync(s => s.OrderId == pending.Id)).ShouldBe(0);
        _audit.ReceivedCalls()
            .Select(c => c.GetArguments())
            .Any(a => a.Length > 0 && a[0] is AuditAction.SeniorPwdDiscountRemoved)
            .ShouldBeTrue();
    }

    [Fact]
    public async Task Update_WrongExpectedTotal_IsRefused()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);
        var created = await CreateHandler().Handle(Sale([Covered(latte)], [Person()], status: OrderStatusEnum.Pending), CancellationToken.None);

        await Should.ThrowAsync<InvalidOperationException>(UpdateHandler().Handle(
            new UpdateOrderCommand
            {
                Id = created.Id,
                Status = OrderStatusEnum.Completed,
                Items = [Covered(latte)],
                SeniorPwdPersons = [Person()],
                ExpectedTotal = 100m,
            },
            CancellationToken.None));
    }

    [Fact]
    public async Task Void_CompletedOrder_ReversesTheDiscountInTheReports()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);
        var created = await CreateHandler().Handle(Sale([Covered(latte)], [Person()]), CancellationToken.None);

        await using var before = TestDb.Create(_dbName);
        var completedOrders = await before.Orders
            .Include(o => o.OrderItems).ThenInclude(i => i.Product)
            .Include(o => o.OrderBundlePromotions)
            .Where(o => o.Id == created.Id)
            .ToListAsync();
        WTF.Calculations.Sales.SalesRules.Summarize(completedOrders, new Dictionary<(Guid ProductId, Guid AddOnId), decimal>()).Revenue.ShouldBe(80m);

        var voided = await new VoidOrderHandler(
            TestDb.Create(_dbName), TestRequest.As(_userId, AppRoles.Admin), TestFakes.Hub(), _audit, TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(TestDb.Create(_dbName)))
            .Handle(new VoidOrderCommand(created.Id, "wrong"), CancellationToken.None);

        voided!.Status.ShouldBe(OrderStatusEnum.Refunded);
        voided.TotalAmount.ShouldBe(80m);
        await using var after = TestDb.Create(_dbName);
        var refunded = await after.Orders
            .Include(o => o.OrderItems).ThenInclude(i => i.Product)
            .Include(o => o.OrderBundlePromotions)
            .Where(o => o.Id == created.Id)
            .ToListAsync();
        WTF.Calculations.Sales.SalesRules.Summarize(refunded, new Dictionary<(Guid ProductId, Guid AddOnId), decimal>()).Revenue.ShouldBe(0m);
    }

    [Fact]
    public async Task GetById_MasksTheIdForACallerWhoCannotApplyIt()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);
        var created = await CreateHandler().Handle(Sale([Covered(latte)], [Person("SC-123456")]), CancellationToken.None);

        var asCashier = await new GetOrderByIdHandler(TestDb.Create(_dbName), TestRequest.As(_userId, AppRoles.Cashier))
            .Handle(new GetOrderByIdQuery(created.Id), CancellationToken.None);
        var asViewer = await new GetOrderByIdHandler(TestDb.Create(_dbName), TestRequest.As(_userId, AppRoles.AdminViewer))
            .Handle(new GetOrderByIdQuery(created.Id), CancellationToken.None);

        asCashier!.SeniorPwdPersons.ShouldHaveSingleItem().IdNumber.ShouldBe("SC-123456");
        asViewer!.SeniorPwdPersons.ShouldHaveSingleItem().IdNumber.ShouldBe("*****3456");
        asViewer.TotalAmount.ShouldBe(80m);
    }

    [Fact]
    public async Task List_AlwaysMasksTheId_AndKeepsTheDiscountedTotal()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);
        await CreateHandler().Handle(Sale([Covered(latte)], [Person("SC-123456")]), CancellationToken.None);

        var orders = await new GetOrdersHandler(TestDb.Create(_dbName), TestRequest.As(_userId, AppRoles.Admin))
            .Handle(new GetOrdersQuery(OrderStatusEnum.All, null), CancellationToken.None);

        var order = orders.ShouldHaveSingleItem();
        order.TotalAmount.ShouldBe(80m);
        order.SeniorPwdPersons.ShouldHaveSingleItem().IdNumber.ShouldBe("*****3456");
    }

    [Fact]
    public async Task IdCheck_FindsTheSameIdUsedToday_ButNotACancelledOrder()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);
        var first = await CreateHandler().Handle(Sale([Covered(latte)], [Person("SC-77")]), CancellationToken.None);
        var handler = new SeniorPwdIdCheckHandler(TestDb.Create(_dbName), TestRequest.As(_userId, AppRoles.Cashier));

        var used = await handler.Handle(new SeniorPwdIdCheckQuery(" SC-77 "), CancellationToken.None);
        var other = await handler.Handle(new SeniorPwdIdCheckQuery("SC-78"), CancellationToken.None);

        used.UsedToday.ShouldBeTrue();
        used.LastOrderNumber.ShouldBe(first.OrderNumber);
        other.UsedToday.ShouldBeFalse();

        await using (var db = TestDb.Create(_dbName))
        {
            (await db.Orders.FindAsync(first.Id))!.StatusId = (int)OrderStatusEnum.Cancelled;
            await db.SaveChangesAsync();
        }

        (await handler.Handle(new SeniorPwdIdCheckQuery("SC-77"), CancellationToken.None)).UsedToday.ShouldBeFalse();
    }

    [Fact]
    public async Task Sync_QueuedOrderWithoutAnId_IsHeldForReview_NotDropped()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);
        await using var db = TestDb.Create(_dbName);
        var command = Sale([new OrderItemRequestDto(latte, 1, [], null, null, QuotedPrice: 100m, SeniorPwdPersonIndex: 0)], [Person("", "")]);

        var reasons = await OfflineOrderReview.FindReasonsAsync(db, command, TimeZoneInfo.Utc, CancellationToken.None);

        reasons.ShouldContain(r => r.Contains("missing the ID number"));

        var held = await CreateHandler().Handle(command with { ReviewFindings = reasons.Select(r => OfflineReason.Hold("Test", r)).ToList(), GateHeld = true }, CancellationToken.None);

        held.Status.ShouldBe(OrderStatusEnum.PendingReview);
        held.TotalAmount.ShouldBe(80m);
    }

    [Fact]
    public async Task Sync_ShopSettingChangedWhileOffline_HoldsTheSale()
    {
        await ConfigureShopAsync(vatRegistered: true);
        var latte = _data.AddProduct("Latte", 100m);
        await using var db = TestDb.Create(_dbName);
        var queued = new OrderItemRequestDto(latte, 1, [], null, null, QuotedPrice: 100m, SeniorPwdPersonIndex: 0);

        // The register ran as a non-VAT shop (80.00); the server now knows the shop is VAT-registered (71.43).
        var reasons = await OfflineOrderReview.FindReasonsAsync(
            db, Sale([queued], [Person()], expectedTotal: 80m), TimeZoneInfo.Utc, CancellationToken.None);

        reasons.ShouldContain(r => r.Contains("Senior/PWD discount now comes to"));
    }
}
