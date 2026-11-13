using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Features.Promotions;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Orders;

public class SeniorPwdEdgeCaseTests
{
    private readonly Guid _userId = Guid.NewGuid();
    private readonly string _dbName = TestDb.NewName();
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly OrderSeed _data;

    public SeniorPwdEdgeCaseTests()
    {
        _data = new OrderSeed(_dbName);
    }

    private CreateOrderHandler CreateHandler(string role = AppRoles.Cashier) =>
        new(TestDb.Create(_dbName), TestRequest.As(_userId, role), TestFakes.Hub(), _audit, TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(TestDb.Create(_dbName)));

    private UpdateOrderHandler UpdateHandler(string role = AppRoles.Admin) =>
        new(TestDb.Create(_dbName), TestRequest.As(_userId, role), TestFakes.Hub(), _audit, TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(TestDb.Create(_dbName)));

    private static SeniorPwdPersonRequestDto Person(string id = "SC-123456", string name = "Lola Remedios", SeniorPwdTypeEnum type = SeniorPwdTypeEnum.Senior, bool idChecked = false) =>
        new(type, id, name, idChecked);

    private static OrderItemRequestDto Covered(Guid productId, int quantity = 1, int person = 0, params OrderItemRequestDto[] addOns) =>
        new(productId, quantity, [.. addOns], null, null, SeniorPwdPersonIndex: person);

    private static OrderItemRequestDto Plain(Guid productId, int quantity = 1, params OrderItemRequestDto[] addOns) =>
        new(productId, quantity, [.. addOns], null, null);

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

    private async Task SetShopSwitchAsync(bool enabled)
    {
        await using var db = TestDb.Create(_dbName);
        (await db.TenantSettings.SingleAsync()).SeniorPwdEnabled = enabled;
        await db.SaveChangesAsync();
    }

    private async Task<Promotion> AddLatteShotPromoAsync(Guid latte, Guid shot, decimal fixedPrice = 80m, int? maxPerOrder = null, bool isActive = true)
    {
        await using var db = TestDb.Create(_dbName);
        var promo = await PromotionSeed.AddDiscountAsync(db, latte, shot, 1, fixedPrice, null, isActive);
        if (maxPerOrder.HasValue)
        {
            (await db.Promotions.FindAsync(promo.Id))!.MaxPerOrder = maxPerOrder;
            await db.SaveChangesAsync();
        }

        return promo;
    }

    private async Task SetPromoActiveAsync(Guid promotionId, bool isActive)
    {
        await using var db = TestDb.Create(_dbName);
        (await db.Promotions.FindAsync(promotionId))!.IsActive = isActive;
        await db.SaveChangesAsync();
    }

    private (Guid Latte, Guid Shot) SeedLatteAndShot()
    {
        var latte = _data.AddProduct("Latte", 100m);
        var shot = _data.AddProduct("Shot", 10m, isAddOn: true);
        _data.AllowAddOn(latte, shot);
        return (latte, shot);
    }

    // (a) an item with an active promotion

    [Fact]
    public async Task Create_CoveringAnItemThatGetsAPromotionPrice_IsRefused()
    {
        await ConfigureShopAsync();
        var (latte, shot) = SeedLatteAndShot();
        await AddLatteShotPromoAsync(latte, shot);

        var ex = await Should.ThrowAsync<InvalidOperationException>(CreateHandler().Handle(
            Sale([Covered(latte, 1, 0, Plain(shot))], [Person()]), CancellationToken.None));

        ex.Message.ShouldContain("promotion");
    }

    [Fact]
    public async Task Create_TheSameItemWithoutThePromotionAddOn_CanBeCovered()
    {
        await ConfigureShopAsync();
        var (latte, shot) = SeedLatteAndShot();
        await AddLatteShotPromoAsync(latte, shot);

        var dto = await CreateHandler().Handle(Sale([Covered(latte)], [Person()], expectedTotal: 80m), CancellationToken.None);

        dto.TotalAmount.ShouldBe(80m);
    }

    [Fact]
    public async Task Create_APendingOrderIsRefusedToo_BecauseItAlreadyHoldsThePromotionUse()
    {
        await ConfigureShopAsync();
        var (latte, shot) = SeedLatteAndShot();
        await AddLatteShotPromoAsync(latte, shot);

        await Should.ThrowAsync<InvalidOperationException>(CreateHandler().Handle(
            Sale([Covered(latte, 1, 0, Plain(shot))], [Person()], status: OrderStatusEnum.Pending), CancellationToken.None));
    }

    [Fact]
    public async Task Complete_APendingCoveredOrder_WhosePromotionBecameActive_IsRefused_AndEligibleAgainWhenItEnds()
    {
        await ConfigureShopAsync();
        var (latte, shot) = SeedLatteAndShot();
        var promo = await AddLatteShotPromoAsync(latte, shot, isActive: false);
        var pending = await CreateHandler().Handle(
            Sale([Covered(latte, 1, 0, Plain(shot))], [Person()], status: OrderStatusEnum.Pending), CancellationToken.None);
        pending.TotalAmount.ShouldBe(88m);

        await SetPromoActiveAsync(promo.Id, true);
        var complete = new UpdateOrderCommand
        {
            Id = pending.Id,
            Status = OrderStatusEnum.Completed,
            Items = [Covered(latte, 1, 0, Plain(shot))],
            SeniorPwdPersons = [Person()],
            ExpectedTotal = 88m,
        };

        var ex = await Should.ThrowAsync<InvalidOperationException>(UpdateHandler().Handle(complete, CancellationToken.None));
        ex.Message.ShouldContain("promotion");

        await SetPromoActiveAsync(promo.Id, false);
        var done = await UpdateHandler().Handle(complete, CancellationToken.None);

        done!.TotalAmount.ShouldBe(88m);
        done.SeniorPwdPersons.ShouldHaveSingleItem().CoveredAmount.ShouldBe(110m);
    }

    // (b) bundles

    [Fact]
    public async Task Create_ABundleLineCannotBeCovered_AndNeitherCanItsItems()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);
        var cake = _data.AddProduct("Cake", 60m);
        Promotion bundle;
        await using (var db = TestDb.Create(_dbName))
        {
            bundle = await PromotionSeed.AddBundleAsync(db, latte, 1, 120m);
        }

        var bundled = new OrderItemRequestDto(latte, 1, [], null, bundle.Id, SeniorPwdPersonIndex: 0);
        var command = Sale([bundled, Plain(cake)], [Person()], status: OrderStatusEnum.Pending) with
        {
            BundlePromotions = [new OrderBundlePromotionRequestDto(bundle.Id, 1)],
        };

        var ex = await Should.ThrowAsync<InvalidOperationException>(CreateHandler().Handle(command, CancellationToken.None));

        ex.Message.ShouldContain("bundle");
    }

    // (c) promotion limited per order: only part of the quantity gets the promotion price

    [Fact]
    public async Task Create_WhenThePromotionLimitCoversOnlyOneItem_TheCoveredItemNeverTakesThePromotionPrice()
    {
        await ConfigureShopAsync();
        var (latte, shot) = SeedLatteAndShot();
        await AddLatteShotPromoAsync(latte, shot, maxPerOrder: 1);

        // The promotion use goes to the plain line first (20 + 10 for the shot); the covered line pays the list price (110) less 20%.
        var dto = await CreateHandler().Handle(
            Sale([Plain(latte, 1, Plain(shot)), Covered(latte, 1, 0, Plain(shot))], [Person()], expectedTotal: 118m),
            CancellationToken.None);

        dto.TotalAmount.ShouldBe(118m);
        var covered = dto.Items.Single(i => i.SeniorPwdPersonId.HasValue);
        covered.PromoLabel.ShouldBeNull();
        covered.DiscountPromotionId.ShouldBeNull();
        covered.Price.ShouldBe(100m);
        dto.SeniorPwdPersons.ShouldHaveSingleItem().CoveredAmount.ShouldBe(110m);
    }

    [Fact]
    public async Task Create_WhenTheCoveredLineComesFirstAndTheLimitWouldGiveItThePromotion_ItIsRefusedNotQuietlyPromoted()
    {
        await ConfigureShopAsync();
        var (latte, shot) = SeedLatteAndShot();
        await AddLatteShotPromoAsync(latte, shot, maxPerOrder: 1);

        await Should.ThrowAsync<InvalidOperationException>(CreateHandler().Handle(
            Sale([Covered(latte, 1, 0, Plain(shot)), Plain(latte, 1, Plain(shot))], [Person()]), CancellationToken.None));
    }

    // (e) add-ons and add-on price overrides

    [Fact]
    public async Task Create_CoversAnAddOnAtItsOverridePrice()
    {
        await ConfigureShopAsync();
        var (latte, shot) = SeedLatteAndShot();
        _data.AddAddOnPriceOverride(latte, shot, 30m);

        var dto = await CreateHandler().Handle(
            Sale([Covered(latte, 2, 0, Plain(shot))], [Person()], expectedTotal: 208m), CancellationToken.None);

        // (100 + 30) x 2 = 260, 20% off = 52.
        dto.SeniorPwdPersons.ShouldHaveSingleItem().CoveredAmount.ShouldBe(260m);
        dto.TotalAmount.ShouldBe(208m);
    }

    // (f) the price moves between pending and complete

    [Fact]
    public async Task Complete_AfterThePriceMoved_RecomputesTheAmountsFromTheCurrentPrice()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);
        var pending = await CreateHandler().Handle(Sale([Covered(latte)], [Person()], status: OrderStatusEnum.Pending), CancellationToken.None);
        await using (var db = TestDb.Create(_dbName))
        {
            (await db.Products.FindAsync(latte))!.Price = 120m;
            await db.SaveChangesAsync();
        }

        var done = await UpdateHandler().Handle(
            new UpdateOrderCommand
            {
                Id = pending.Id,
                Status = OrderStatusEnum.Completed,
                Items = [Covered(latte)],
                SeniorPwdPersons = [Person()],
                ExpectedTotal = 96m,
            },
            CancellationToken.None);

        done!.TotalAmount.ShouldBe(96m);
        var person = done.SeniorPwdPersons.ShouldHaveSingleItem();
        person.CoveredAmount.ShouldBe(120m);
        person.DiscountAmount.ShouldBe(24m);
    }

    // (h) bad input

    [Theory]
    [InlineData(-1)]
    [InlineData(1)]
    [InlineData(int.MaxValue)]
    public async Task Create_APersonIndexOutsideThePersonList_IsRefused(int index)
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);

        await Should.ThrowAsync<InvalidOperationException>(CreateHandler().Handle(
            Sale([Covered(latte, 1, index)], [Person()]), CancellationToken.None));
    }

    [Fact]
    public async Task Create_CoveredItemsWithoutAnyPerson_IsRefused()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);

        await Should.ThrowAsync<InvalidOperationException>(CreateHandler().Handle(
            Sale([Covered(latte)], []), CancellationToken.None));
    }

    [Fact]
    public async Task Create_ANullIdOrName_IsRefusedInsteadOfCrashing()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);
        var person = new SeniorPwdPersonRequestDto(SeniorPwdTypeEnum.Senior, null!, null!);

        var ex = await Should.ThrowAsync<InvalidOperationException>(CreateHandler().Handle(
            Sale([Covered(latte)], [person]), CancellationToken.None));

        ex.Message.ShouldContain("ID number");
    }

    [Theory]
    [InlineData(51, 10)]
    [InlineData(10, 101)]
    public async Task Create_OverLongIdOrName_IsRefused(int idLength, int nameLength)
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);

        await Should.ThrowAsync<InvalidOperationException>(CreateHandler().Handle(
            Sale([Covered(latte)], [Person(new string('1', idLength), new string('n', nameLength))]), CancellationToken.None));
    }

    [Fact]
    public async Task Create_TheLongestAllowedIdAndName_AreSaved()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);

        var dto = await CreateHandler().Handle(
            Sale([Covered(latte)], [Person(new string('1', 50), new string('n', 100))]), CancellationToken.None);

        dto.SeniorPwdPersons.ShouldHaveSingleItem().IdNumber.Length.ShouldBe(50);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(3)]
    [InlineData(255)]
    public async Task Create_AnUnknownDiscountType_IsRefused(int type)
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);

        await Should.ThrowAsync<InvalidOperationException>(CreateHandler().Handle(
            Sale([Covered(latte)], [Person(type: (SeniorPwdTypeEnum)type)]), CancellationToken.None));
    }

    [Fact]
    public async Task Create_ControlCharactersInTheIdOrName_AreRefused()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);

        await Should.ThrowAsync<InvalidOperationException>(CreateHandler().Handle(
            Sale([Covered(latte)], [Person("SC-1\n2", "Lola")]), CancellationToken.None));
        await Should.ThrowAsync<InvalidOperationException>(CreateHandler().Handle(
            Sale([Covered(latte)], [Person("SC-12", "Lo\tla")]), CancellationToken.None));
    }

    [Fact]
    public async Task Create_TheSameIdForTwoPersonsOnOneOrder_IsAllowed_TheRegisterOnlyWarns()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);
        var cake = _data.AddProduct("Cake", 50m);

        var dto = await CreateHandler().Handle(
            Sale([Covered(latte, 1, 0), Covered(cake, 1, 1)], [Person("SC-1", "Lola"), Person("SC-1", "Lola Again")]),
            CancellationToken.None);

        dto.SeniorPwdPersons!.Count.ShouldBe(2);
        dto.TotalAmount.ShouldBe(120m);
    }

    [Fact]
    public async Task Create_TheSamePersonOnTwoCoveredLines_KeepsOneRowWithBothAmounts()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);
        var cake = _data.AddProduct("Cake", 50m);

        var dto = await CreateHandler().Handle(
            Sale([Covered(latte, 1, 0), Covered(cake, 2, 0), Plain(latte)], [Person()]), CancellationToken.None);

        var person = dto.SeniorPwdPersons.ShouldHaveSingleItem();
        person.CoveredAmount.ShouldBe(200m);
        person.DiscountAmount.ShouldBe(40m);
        dto.TotalAmount.ShouldBe(260m);
    }

    // (i) tips, zero price, large quantity, cash

    [Fact]
    public async Task Create_TipsAreNeverCovered_AndCashChangeUsesTheReducedTotal()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);
        var command = Sale([Covered(latte)], [Person()], expectedTotal: 80m) with
        {
            Tips = 10m,
            PaymentMethod = PaymentMethodEnum.Cash,
            AmountReceived = 100m,
        };

        var dto = await CreateHandler().Handle(command, CancellationToken.None);

        dto.TotalAmount.ShouldBe(80m);
        dto.SeniorPwdPersons.ShouldHaveSingleItem().CoveredAmount.ShouldBe(100m);
        // 100 received - 80 total - 10 tip.
        dto.ChangeAmount.ShouldBe(10m);
    }

    [Fact]
    public async Task Create_CashThatCoversTheFullPriceButNotTheReducedTotalIsStillFine_AndShortCashIsRefused()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);
        var enough = Sale([Covered(latte)], [Person()], expectedTotal: 80m) with { PaymentMethod = PaymentMethodEnum.Cash, AmountReceived = 80m };
        var short_ = Sale([Covered(latte)], [Person()], expectedTotal: 80m) with { PaymentMethod = PaymentMethodEnum.Cash, AmountReceived = 79.99m };

        (await CreateHandler().Handle(enough, CancellationToken.None)).ChangeAmount.ShouldBe(0m);
        await Should.ThrowAsync<InvalidOperationException>(CreateHandler().Handle(short_, CancellationToken.None));
    }

    [Fact]
    public async Task Create_AFreeItemAloneCannotBeTheOnlyCoveredItem()
    {
        await ConfigureShopAsync();
        var water = _data.AddProduct("Water", 0m);

        var ex = await Should.ThrowAsync<InvalidOperationException>(CreateHandler().Handle(
            Sale([Covered(water)], [Person()]), CancellationToken.None));

        ex.Message.ShouldContain("no item covered");
    }

    [Fact]
    public async Task Create_ALargeQuantity_AddsUpExactly()
    {
        await ConfigureShopAsync(vatRegistered: true);
        var latte = _data.AddProduct("Latte", 99.99m);

        var dto = await CreateHandler().Handle(Sale([Covered(latte, 1000)], [Person()]), CancellationToken.None);

        var person = dto.SeniorPwdPersons.ShouldHaveSingleItem();
        person.CoveredAmount.ShouldBe(99990m);
        (person.CoveredAmount - person.VatExemptAmount - person.DiscountAmount).ShouldBe(dto.TotalAmount);
    }

    // (j) online orders

    [Fact]
    public async Task Update_AStaffMemberApplyingItToAnOnlineOrder_NeedsTheIdChecked()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);
        var created = await CreateHandler().Handle(Sale([Plain(latte)], [], status: OrderStatusEnum.Pending), CancellationToken.None);
        await using (var db = TestDb.Create(_dbName))
        {
            (await db.Orders.FindAsync(created.Id))!.Source = (byte)OrderSourceEnum.CustomerLink;
            await db.SaveChangesAsync();
        }

        var unchecked_ = new UpdateOrderCommand
        {
            Id = created.Id,
            Status = OrderStatusEnum.Pending,
            Items = [Covered(latte)],
            SeniorPwdPersons = [Person()],
        };

        var ex = await Should.ThrowAsync<InvalidOperationException>(UpdateHandler().Handle(unchecked_, CancellationToken.None));
        ex.Message.ShouldContain("Check the ID");

        var checked_ = unchecked_ with { SeniorPwdPersons = [Person(idChecked: true)] };
        var done = await UpdateHandler().Handle(checked_, CancellationToken.None);

        done!.TotalAmount.ShouldBe(80m);
    }

    // (k) permission and the shop switch changing while an order waits

    [Fact]
    public async Task Update_ARoleWithoutThePermission_CannotAddTheDiscount()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);
        var created = await CreateHandler().Handle(Sale([Plain(latte)], [], status: OrderStatusEnum.Pending), CancellationToken.None);

        await Should.ThrowAsync<Exception>(UpdateHandler(AppRoles.AdminViewer).Handle(
            new UpdateOrderCommand
            {
                Id = created.Id,
                Status = OrderStatusEnum.Pending,
                Items = [Covered(latte)],
                SeniorPwdPersons = [Person()],
            },
            CancellationToken.None));
    }

    [Fact]
    public async Task Complete_APendingOrderWithTheDiscount_AfterTheShopSwitchedItOff_IsRefusedUntilTheDiscountIsRemoved()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);
        var pending = await CreateHandler().Handle(Sale([Covered(latte)], [Person()], status: OrderStatusEnum.Pending), CancellationToken.None);
        await SetShopSwitchAsync(false);

        var withDiscount = new UpdateOrderCommand
        {
            Id = pending.Id,
            Status = OrderStatusEnum.Completed,
            Items = [Covered(latte)],
            SeniorPwdPersons = [Person()],
        };
        var ex = await Should.ThrowAsync<InvalidOperationException>(UpdateHandler().Handle(withDiscount, CancellationToken.None));
        ex.Message.ShouldContain("turned off");

        var without = withDiscount with { Items = [Plain(latte)], SeniorPwdPersons = [], ExpectedTotal = 100m };
        var done = await UpdateHandler().Handle(without, CancellationToken.None);

        done!.TotalAmount.ShouldBe(100m);
        done.SeniorPwdPersons.ShouldBeNull();
    }

    [Fact]
    public async Task Correct_ACompletedOrderWithTheDiscount_StillWorksForAnAdminAfterTheSwitchIsOff()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);
        var done = await CreateHandler().Handle(Sale([Covered(latte)], [Person()]), CancellationToken.None);
        await SetShopSwitchAsync(false);

        var corrected = await UpdateHandler().Handle(
            new UpdateOrderCommand
            {
                Id = done.Id,
                Status = OrderStatusEnum.Completed,
                Items = [Covered(latte, 2)],
                SeniorPwdPersons = [Person()],
                OverrideReason = "Added a second latte",
                IsOverride = true,
            },
            CancellationToken.None);

        corrected!.TotalAmount.ShouldBe(160m);
    }

    // (l) offline

    [Fact]
    public async Task Sync_AQueuedCoveredLineThatHadAPromotionPrice_IsHeldForReview()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);
        await using var db = TestDb.Create(_dbName);
        var queued = new OrderItemRequestDto(latte, 1, [], null, null, QuotedPrice: 80m, QuotedOriginalPrice: 100m, QuotedPromoLabel: "Promo", SeniorPwdPersonIndex: 0);

        var reasons = await OfflineOrderReview.FindReasonsAsync(
            db, Sale([queued], [Person()], expectedTotal: 64m), TimeZoneInfo.Utc, CancellationToken.None);

        reasons.ShouldContain(r => r.Contains("promotion"));
    }

    [Fact]
    public async Task Sync_AQueuedCoveredLineOfAProductNowMarkedNotFoodOrDrink_IsHeldForReview()
    {
        await ConfigureShopAsync();
        var mug = _data.AddProduct("Mug", 250m);
        await using (var write = TestDb.Create(_dbName))
        {
            (await write.Products.FindAsync(mug))!.IsSeniorPwdEligible = false;
            await write.SaveChangesAsync();
        }

        await using var db = TestDb.Create(_dbName);
        var queued = new OrderItemRequestDto(mug, 1, [], null, null, QuotedPrice: 250m, SeniorPwdPersonIndex: 0);

        var reasons = await OfflineOrderReview.FindReasonsAsync(
            db, Sale([queued], [Person()], expectedTotal: 200m), TimeZoneInfo.Utc, CancellationToken.None);

        reasons.ShouldContain(r => r.Contains("Mug"));
    }

    [Fact]
    public async Task Sync_ASecondSyncOfTheSameQueuedOrder_DoesNotSaveTheDiscountTwice()
    {
        await ConfigureShopAsync();
        var latte = _data.AddProduct("Latte", 100m);
        var command = Sale([Covered(latte)], [Person()], expectedTotal: 80m) with { OfflineLocalId = "POS-1" };

        var first = await CreateHandler().Handle(command, CancellationToken.None);

        await using var db = TestDb.Create(_dbName);
        (await db.OrderSeniorPwdDiscounts.CountAsync(s => s.OrderId == first.Id)).ShouldBe(1);
    }
}
