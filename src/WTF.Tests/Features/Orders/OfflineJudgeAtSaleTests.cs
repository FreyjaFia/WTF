using MediatR;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Catalog;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Calculations.Catalog;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Orders;

public class OfflineJudgeAtSaleTests
{
    private static readonly DateTime Sold = new(2026, 6, 10, 12, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime DeviceSynced = Sold.AddHours(-3);

    private readonly Guid _userId = Guid.NewGuid();
    private readonly Guid _tenantId = TenantDefaults.DefaultTenantId;
    private readonly string _dbName = TestDb.NewName();
    private readonly ICurrentTenant _tenant;

    public OfflineJudgeAtSaleTests()
    {
        _tenant = new FixedTenant(_tenantId);
    }

    [Fact]
    public async Task APriceChangedAfterTheSale_IsNotAConflict()
    {
        var latte = await SeedProductAsync("Latte", 160m);
        await LogAsync(CatalogEntityTypes.Baseline, _tenantId, CatalogHistoryRules.BaselineField, null, "1", Sold.AddYears(-1), _tenantId);
        await LogAsync(CatalogEntityTypes.Product, latte, "Price", "150.00", "160.00", Sold.AddHours(2));

        var result = await SyncAsync(Order("OFF-1", DeviceSynced, Line(latte, 150m)));

        result.Status.ShouldBe(OrderStatusEnum.Completed);
        result.Reasons.ShouldBeEmpty();
    }

    [Fact]
    public async Task APriceChangedAfterTheDeviceUpdatedAndBeforeTheSale_IsHeld()
    {
        var latte = await SeedProductAsync("Latte", 160m);
        await LogAsync(CatalogEntityTypes.Baseline, _tenantId, CatalogHistoryRules.BaselineField, null, "1", Sold.AddYears(-1), _tenantId);
        await LogAsync(CatalogEntityTypes.Product, latte, "Price", "150.00", "160.00", Sold.AddHours(-1));

        var result = await SyncAsync(Order("OFF-2", DeviceSynced, Line(latte, 150m)));

        result.Status.ShouldBe(OrderStatusEnum.PendingReview);
        result.ReasonDetails!.Single().Code.ShouldBe(OfflineReasonCodes.PriceChanged);
        result.ReasonDetails!.Single().ExpectedValue.ShouldBe("160.00");
    }

    [Fact]
    public async Task ADeviceThatDidNotReportItsCatalogTime_IsJudgedAgainstTodaysCatalog()
    {
        var latte = await SeedProductAsync("Latte", 160m);
        await LogAsync(CatalogEntityTypes.Baseline, _tenantId, CatalogHistoryRules.BaselineField, null, "1", Sold.AddYears(-1), _tenantId);
        await LogAsync(CatalogEntityTypes.Product, latte, "Price", "150.00", "160.00", Sold.AddHours(2));

        var result = await SyncAsync(Order("OFF-3", null, Line(latte, 150m)));

        result.Status.ShouldBe(OrderStatusEnum.PendingReview);
    }

    [Fact]
    public async Task AProductWithNoHistory_IsJudgedAgainstTodaysCatalog()
    {
        var latte = await SeedProductAsync("Latte", 160m);

        var result = await SyncAsync(Order("OFF-4", DeviceSynced, Line(latte, 150m)));

        result.Status.ShouldBe(OrderStatusEnum.PendingReview);
    }

    [Fact]
    public async Task AProductDeactivatedAfterTheSale_IsNotAConflict()
    {
        var latte = await SeedProductAsync("Latte", 150m, active: false);
        await LogAsync(CatalogEntityTypes.Baseline, _tenantId, CatalogHistoryRules.BaselineField, null, "1", Sold.AddYears(-1), _tenantId);
        await LogAsync(CatalogEntityTypes.Product, latte, "IsActive", "true", "false", Sold.AddMinutes(30));

        var result = await SyncAsync(Order("OFF-5", DeviceSynced, Line(latte, 150m)));

        result.Status.ShouldBe(OrderStatusEnum.Completed);
    }

    [Fact]
    public async Task AnAddOnOverrideRemovedAfterTheSale_IsNotAConflict()
    {
        var latte = await SeedProductAsync("Latte", 150m);
        var oat = await SeedProductAsync("Oat Milk", 30m, addOn: true);
        var key = CatalogHistoryRules.AddOnOverrideKey(latte, oat);
        await LogAsync(CatalogEntityTypes.Baseline, _tenantId, CatalogHistoryRules.BaselineField, null, "1", Sold.AddYears(-1), _tenantId);
        await LogAsync(CatalogEntityTypes.AddOnPriceOverride, key, "Price", "20.00", null, Sold.AddHours(1));

        var result = await SyncAsync(Order("OFF-6", DeviceSynced, Line(latte, 150m, (oat, 20m))));

        result.Status.ShouldBe(OrderStatusEnum.Completed);
    }

    [Fact]
    public async Task AVatSettingTurnedOnAfterTheSale_KeepsTheDiscountTheRegisterQuoted()
    {
        var latte = await SeedProductAsync("Latte", 100m);
        await SeedShopAsync(enabled: true, vatRegistered: true);
        await LogAsync(CatalogEntityTypes.Baseline, _tenantId, CatalogHistoryRules.BaselineField, null, "1", Sold.AddYears(-1), _tenantId);
        await LogAsync(CatalogEntityTypes.TenantSettings, _tenantId, "VatRegistered", "false", "true", Sold.AddHours(1));

        var result = await SyncAsync(SeniorSale("OFF-7", DeviceSynced, latte, expectedTotal: 80m));

        result.Status.ShouldBe(OrderStatusEnum.Completed);
        result.Reasons.ShouldBeEmpty();
        await using var db = TestDb.Create(_dbName, _tenant);
        var person = db.OrderSeniorPwdDiscounts.Single();
        person.DiscountAmount.ShouldBe(20m);
        person.VatExemptAmount.ShouldBe(0m);
    }

    [Fact]
    public async Task TheDiscountSwitchedOffAfterTheSale_IsNotAConflict()
    {
        var latte = await SeedProductAsync("Latte", 100m);
        await SeedShopAsync(enabled: false, vatRegistered: false);
        await LogAsync(CatalogEntityTypes.Baseline, _tenantId, CatalogHistoryRules.BaselineField, null, "1", Sold.AddYears(-1), _tenantId);
        await LogAsync(CatalogEntityTypes.TenantSettings, _tenantId, "SeniorPwdEnabled", "true", "false", Sold.AddHours(1));

        var after = await SyncAsync(SeniorSale("OFF-8", DeviceSynced, latte, expectedTotal: 80m));

        after.Status.ShouldBe(OrderStatusEnum.Completed);

    }

    [Fact]
    public async Task TheDiscountSwitchedOffBeforeTheSaleAndAfterTheDeviceUpdated_IsHeld()
    {
        var latte = await SeedProductAsync("Latte", 100m);
        await SeedShopAsync(enabled: false, vatRegistered: false);
        await LogAsync(CatalogEntityTypes.Baseline, _tenantId, CatalogHistoryRules.BaselineField, null, "1", Sold.AddYears(-1), _tenantId);
        await LogAsync(CatalogEntityTypes.TenantSettings, _tenantId, "SeniorPwdEnabled", "true", "false", Sold.AddMinutes(-30));

        var result = await SyncAsync(SeniorSale("OFF-9", DeviceSynced, latte, expectedTotal: 80m));

        result.Status.ShouldBe(OrderStatusEnum.PendingReview);
        result.ReasonDetails!.Select(d => d.Code).ShouldContain(OfflineReasonCodes.SeniorPwdDisabled);
    }

    [Fact]
    public async Task TheSameIdTwiceInADay_IsOnlyANote()
    {
        var latte = await SeedProductAsync("Latte", 100m);
        await SeedShopAsync(enabled: true, vatRegistered: false);

        var first = await SyncAsync(SeniorSale("OFF-10", null, latte, expectedTotal: 80m));
        var second = await SyncAsync(SeniorSale("OFF-11", null, latte, expectedTotal: 80m));

        first.Status.ShouldBe(OrderStatusEnum.Completed);
        second.Status.ShouldBe(OrderStatusEnum.Completed);
        second.ReasonDetails!.Single().Code.ShouldBe(OfflineReasonCodes.SeniorPwdIdRepeated);
        second.ReasonDetails!.Single().Severity.ShouldBe("Note");
    }

    private static CreateOrderCommand SeniorSale(string localId, DateTime? deviceSynced, Guid productId, decimal expectedTotal) =>
        Order(localId, deviceSynced, new OrderItemRequestDto(productId, 1, [], null, null, 100m, SeniorPwdPersonIndex: 0)) with
        {
            SeniorPwdPersons = [new SeniorPwdPersonRequestDto(SeniorPwdTypeEnum.Senior, "SC-1", "Lola Remedios")],
            ExpectedTotal = expectedTotal,
        };

    private async Task SeedShopAsync(bool enabled, bool vatRegistered)
    {
        await using var db = TestDb.Create(_dbName, _tenant);
        db.TenantSettings.Add(new TenantSetting
        {
            TenantId = _tenantId,
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

    private static CreateOrderCommand Order(string localId, DateTime? deviceSynced, OrderItemRequestDto line) =>
        new()
        {
            Status = OrderStatusEnum.Completed,
            Items = [line],
            OfflineLocalId = localId,
            CreatedAt = Sold,
            CatalogSyncedAt = deviceSynced,
            PaymentMethod = PaymentMethodEnum.Cash,
            AmountReceived = 1000m,
        };

    private static OrderItemRequestDto Line(Guid productId, decimal quoted, (Guid Id, decimal Price)? addOn = null) =>
        new(productId, 1, addOn is null ? [] : [new OrderItemRequestDto(addOn.Value.Id, 1, [], null, null, addOn.Value.Price)], null, null, quoted);

    private async Task<OfflineSyncResultDto> SyncAsync(CreateOrderCommand order)
    {
        var db = TestDb.Create(_dbName, _tenant);
        var accessor = TestRequest.As(_userId, AppRoles.Admin);
        var create = new CreateOrderHandler(db, accessor, TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(db));
        var sender = Substitute.For<ISender>();
        sender.Send(Arg.Any<CreateOrderCommand>(), Arg.Any<CancellationToken>())
            .Returns(call => create.Handle(call.Arg<CreateOrderCommand>(), call.Arg<CancellationToken>()));
        var results = await new SyncOfflineOrdersHandler(db, sender, accessor).Handle(new SyncOfflineOrdersCommand([order]), CancellationToken.None);
        return results.Single();
    }

    private async Task<Guid> SeedProductAsync(string name, decimal price, bool active = true, bool addOn = false)
    {
        await using var db = TestDb.Create(_dbName, _tenant);
        var product = new Product { Id = Guid.NewGuid(), Name = name, Price = price, IsActive = active, IsAddOn = addOn, Code = name, CreatedAt = Sold, CreatedBy = _userId };
        db.Products.Add(product);
        await db.SaveChangesAsync();
        return product.Id;
    }

    private async Task LogAsync(string entityType, Guid entityId, string field, string? oldValue, string? newValue, DateTime effectiveFrom, Guid? forId = null)
    {
        await using var db = TestDb.Create(_dbName, _tenant);
        db.CatalogChangeLogs.Add(new CatalogChangeLog
        {
            Id = Guid.NewGuid(),
            EntityType = entityType,
            EntityId = forId ?? entityId,
            Field = field,
            OldValue = oldValue,
            NewValue = newValue,
            EffectiveFrom = effectiveFrom,
            CreatedAt = effectiveFrom,
        });
        await db.SaveChangesAsync();
    }

    private sealed class FixedTenant(Guid id) : ICurrentTenant
    {
        public bool FilterEnabled => true;

        public Guid? TenantId => id;

        public Guid? StampTenantId => id;
    }
}
