using MediatR;
using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Catalog;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Products;
using WTF.Api.Features.Products.DTOs;
using WTF.Api.Features.Sync;
using WTF.Calculations.Catalog;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Database;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Branches;

public class BranchPriceDatabaseTests
{
    private static readonly Guid Tenant = TenantDefaults.DefaultTenantId;

    private sealed record Shop(SqlTestDatabase Database, Guid UserId, Guid Makati, Guid Cebu, Guid Latte, Guid OatMilk, Guid Syrup);

    // Latte 160 in the shop and 175 in Cebu. Oat Milk (add-on) 20 in the shop and 25 in Cebu. Syrup (add-on) 10, no branch price.
    private static async Task<Shop> OpenShopAsync()
    {
        var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var latte = await SqlSeed.ProductAsync(database, user.Id, "Latte", 160m);
        var oat = await SqlSeed.ProductAsync(database, user.Id, "Oat Milk", 20m);
        var syrup = await SqlSeed.ProductAsync(database, user.Id, "Syrup", 10m);
        await using var db = database.CreateContext();
        db.Products.Where(p => p.Id == oat.Id || p.Id == syrup.Id).ToList().ForEach(p => p.IsAddOn = true);
        var makati = await db.Branches.Where(b => b.IsMain).Select(b => b.Id).SingleAsync();
        var cebu = SqlTestDatabase.MainBranch(Tenant, "CEB");
        cebu.IsMain = false;
        cebu.Name = "Cebu";
        db.Branches.Add(cebu);
        db.ProductAddOns.AddRange(
            new ProductAddOn { ProductId = latte.Id, AddOnId = oat.Id, AddOnTypeId = CatalogSeed.Extra, IsActive = true },
            new ProductAddOn { ProductId = latte.Id, AddOnId = syrup.Id, AddOnTypeId = CatalogSeed.Extra, IsActive = true });
        db.ProductBranchPrices.AddRange(
            new ProductBranchPrice { Id = Guid.NewGuid(), TenantId = Tenant, ProductId = latte.Id, BranchId = cebu.Id, Price = 175m, CreatedAt = DateTime.UtcNow },
            new ProductBranchPrice { Id = Guid.NewGuid(), TenantId = Tenant, ProductId = oat.Id, BranchId = cebu.Id, Price = 25m, CreatedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
        return new Shop(database, user.Id, makati, cebu.Id, latte.Id, oat.Id, syrup.Id);
    }

    private static WTFDbContext In(Shop shop, Guid? active) =>
        shop.Database.CreateContext(new FixedTenant(Tenant), new FixedBranch([shop.Makati, shop.Cebu], active, false));

    private static WTFDbContext Limited(Shop shop, Guid branch) =>
        shop.Database.CreateContext(new FixedTenant(Tenant), new FixedBranch([branch], branch, true));

    private static async Task<OrderDto> SellAsync(Shop shop, Guid branch, params Guid[] addOns)
    {
        await using var db = In(shop, branch);
        var accessor = TestRequest.As(shop.UserId, AppRoles.Cashier);
        var handler = TestFakes.CreateOrderHandler(db, accessor);
        return await handler.Handle(new CreateOrderCommand
        {
            Status = OrderStatusEnum.Completed,
            Items = [new OrderItemRequestDto(shop.Latte, 1, [.. addOns.Select(a => new OrderItemRequestDto(a, 1, [], null, null))], null, null)],
            PaymentMethod = PaymentMethodEnum.Cash,
            AmountReceived = 500m,
        }, CancellationToken.None);
    }

    private static SaveProductBranchPricesHandler Save(WTFDbContext db, Guid userId) =>
        new(db, TestRequest.As(userId, AppRoles.Admin), TestFakes.Audit());

    [SqlFact]
    public async Task ACompletedSale_InABranchWithItsOwnPrice_KeepsThatPriceOnTheLineAndTheTotal()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        var order = await SellAsync(shop, shop.Cebu, shop.OatMilk, shop.Syrup);

        var line = order.Items.Single();
        line.Price.ShouldBe(175m);
        line.OriginalPrice.ShouldBe(175m);
        line.AddOns.Single(a => a.ProductId == shop.OatMilk).Price.ShouldBe(25m);
        line.AddOns.Single(a => a.ProductId == shop.Syrup).Price.ShouldBe(10m);
        order.TotalAmount.ShouldBe(210m);
    }

    [SqlFact]
    public async Task ACompletedSale_InABranchWithoutAPrice_UsesTheShopPrice()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        var order = await SellAsync(shop, shop.Makati, shop.OatMilk);

        order.Items.Single().Price.ShouldBe(160m);
        order.TotalAmount.ShouldBe(180m);
    }

    [SqlFact]
    public async Task AnAddOnPriceSetForOneProduct_StillBeatsTheBranchPrice()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        await using (var db = shop.Database.CreateContext())
        {
            db.ProductAddOnPriceOverrides.Add(new ProductAddOnPriceOverride
            {
                Id = Guid.NewGuid(),
                TenantId = Tenant,
                ProductId = shop.Latte,
                AddOnId = shop.OatMilk,
                Price = 15m,
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        var order = await SellAsync(shop, shop.Cebu, shop.OatMilk);

        order.Items.Single().AddOns.Single().Price.ShouldBe(15m);
        order.TotalAmount.ShouldBe(190m);
    }

    [SqlFact]
    public async Task APendingOrder_ShowsTheBranchPriceOfItsOwnBranch_NotTheBranchOpenWhenItIsViewed()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        Guid id;
        await using (var db = In(shop, shop.Cebu))
        {
            var created = await TestFakes.CreateOrderHandler(db, TestRequest.As(shop.UserId, AppRoles.Cashier)).Handle(new CreateOrderCommand
            {
                Status = OrderStatusEnum.Pending,
                Items = [new OrderItemRequestDto(shop.Latte, 2, [new OrderItemRequestDto(shop.OatMilk, 1, [], null, null)], null, null)],
            }, CancellationToken.None);
            id = created.Id;
            created.TotalAmount.ShouldBe(400m);
        }

        await using var makatiView = In(shop, shop.Makati);
        var seen = await new GetOrderByIdHandler(makatiView, TestFakes.Features).Handle(new GetOrderByIdQuery(id), CancellationToken.None);
        seen!.TotalAmount.ShouldBe(400m);
        seen.Items.Single().Price.ShouldBe(175m);
    }

    [SqlFact]
    public async Task ChangingABranchPrice_DoesNotChangeASaleAlreadyMade()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        var order = await SellAsync(shop, shop.Cebu);

        await using (var db = In(shop, null))
        {
            await Save(db, shop.UserId).Handle(
                new SaveProductBranchPricesCommand(shop.Latte, [new ProductBranchPriceInputDto(shop.Cebu, 200m)]), CancellationToken.None);
        }

        await using var view = In(shop, null);
        var seen = await new GetOrderByIdHandler(view, TestFakes.Features).Handle(new GetOrderByIdQuery(order.Id), CancellationToken.None);
        seen!.TotalAmount.ShouldBe(175m);
    }

    [SqlFact]
    public async Task TheCatalogOfABranch_ListsItsOwnPrices_AndTheShopPriceWhereThereIsNone()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        async Task<PosCatalogDtoView> CatalogAsync(Guid branch)
        {
            await using var db = In(shop, branch);
            var catalog = await new GetPosCatalogHandler(db, TestRequest.As(shop.UserId, AppRoles.Cashier), TestFakes.Features).Handle(new GetPosCatalogQuery(), CancellationToken.None);
            var add = catalog.AddOnsByProductId[shop.Latte].SelectMany(g => g.Options).ToDictionary(i => i.Id, i => i.Price);
            return new PosCatalogDtoView(catalog.Products.Single(p => p.Id == shop.Latte).Price, add[shop.OatMilk], add[shop.Syrup]);
        }

        (await CatalogAsync(shop.Cebu)).ShouldBe(new PosCatalogDtoView(175m, 25m, 10m));
        (await CatalogAsync(shop.Makati)).ShouldBe(new PosCatalogDtoView(160m, 20m, 10m));
    }

    private sealed record PosCatalogDtoView(decimal Latte, decimal OatMilk, decimal Syrup);

    [SqlFact]
    public async Task SavingBranchPrices_SetsChangesAndClearsThem_AndAnEmptyPriceGoesBackToTheShopPrice()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        await using var db = In(shop, null);
        var handler = Save(db, shop.UserId);

        var changed = await handler.Handle(new SaveProductBranchPricesCommand(shop.Latte,
            [new ProductBranchPriceInputDto(shop.Cebu, 180m), new ProductBranchPriceInputDto(shop.Makati, 165m)]), CancellationToken.None);
        changed!.Branches.Single(b => b.BranchId == shop.Cebu).Price.ShouldBe(180m);
        changed.Branches.Single(b => b.BranchId == shop.Makati).EffectivePrice.ShouldBe(165m);

        var cleared = await handler.Handle(new SaveProductBranchPricesCommand(shop.Latte,
            [new ProductBranchPriceInputDto(shop.Cebu, null)]), CancellationToken.None);
        var cebu = cleared!.Branches.Single(b => b.BranchId == shop.Cebu);
        cebu.Price.ShouldBeNull();
        cebu.EffectivePrice.ShouldBe(160m);
        cleared.Branches.Single(b => b.BranchId == shop.Makati).Price.ShouldBe(165m);
        cleared.ShopPrice.ShouldBe(160m);
    }

    [SqlTheory]
    [InlineData(0)]
    [InlineData(-5)]
    [InlineData(1000000)]
    [InlineData(10.555)]
    public async Task ABranchPrice_OutsideTheAllowedRange_IsRefused(double price)
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        await using var db = In(shop, null);

        await Should.ThrowAsync<InvalidOperationException>(() => Save(db, shop.UserId).Handle(
            new SaveProductBranchPricesCommand(shop.Latte, [new ProductBranchPriceInputDto(shop.Cebu, (decimal)price)]), CancellationToken.None));
    }

    [SqlFact]
    public async Task ABranchThatIsNotInTheShop_OrListedTwice_IsRefused()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        await using var db = In(shop, null);
        var handler = Save(db, shop.UserId);

        await Should.ThrowAsync<InvalidOperationException>(() => handler.Handle(
            new SaveProductBranchPricesCommand(shop.Latte, [new ProductBranchPriceInputDto(Guid.NewGuid(), 100m)]), CancellationToken.None));
        await Should.ThrowAsync<InvalidOperationException>(() => handler.Handle(
            new SaveProductBranchPricesCommand(shop.Latte,
                [new ProductBranchPriceInputDto(shop.Cebu, 100m), new ProductBranchPriceInputDto(shop.Cebu, 120m)]), CancellationToken.None));
    }

    [SqlFact]
    public async Task APersonLimitedToOneBranch_CanOnlyChangeThePricesOfThatBranch_ButSeesAll()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        await using var db = Limited(shop, shop.Makati);
        var handler = Save(db, shop.UserId);

        await Should.ThrowAsync<ForbiddenActionException>(() => handler.Handle(
            new SaveProductBranchPricesCommand(shop.Latte, [new ProductBranchPriceInputDto(shop.Cebu, 190m)]), CancellationToken.None));

        var saved = await handler.Handle(
            new SaveProductBranchPricesCommand(shop.Latte, [new ProductBranchPriceInputDto(shop.Makati, 162m)]), CancellationToken.None);
        saved!.Branches.Single(b => b.BranchId == shop.Cebu).Price.ShouldBe(175m);
        saved.Branches.Single(b => b.BranchId == shop.Makati).Price.ShouldBe(162m);
    }

    [SqlFact]
    public async Task AnUnknownProduct_GivesNothingBack()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        await using var db = In(shop, null);

        (await new GetProductBranchPricesHandler(db).Handle(new GetProductBranchPricesQuery(Guid.NewGuid()), CancellationToken.None)).ShouldBeNull();
        (await Save(db, shop.UserId).Handle(new SaveProductBranchPricesCommand(Guid.NewGuid(), []), CancellationToken.None)).ShouldBeNull();
    }

    private static readonly DateTime Sold = DateTime.UtcNow.AddHours(-4);

    private static async Task<OfflineSyncResultDto> SyncSaleAsync(Shop shop, decimal quoted, DateTime? deviceSynced)
    {
        await using var db = In(shop, shop.Cebu);
        var accessor = TestRequest.As(shop.UserId, AppRoles.Admin);
        var create = TestFakes.CreateOrderHandler(db, accessor);
        var sender = Substitute.For<ISender>();
        sender.Send(Arg.Any<IRequest<OrderDto>>(), Arg.Any<CancellationToken>())
            .Returns(call => create.Handle((CreateOrderCommand)call.Arg<IRequest<OrderDto>>(), call.Arg<CancellationToken>()));
        var results = await new SyncOfflineOrdersHandler(db, sender, accessor, TestFakes.Features).Handle(
            new SyncOfflineOrdersCommand([new CreateOrderCommand
            {
                Status = OrderStatusEnum.Completed,
                Items = [new OrderItemRequestDto(shop.Latte, 1, [], null, null, quoted)],
                OfflineLocalId = $"OFF-{Guid.NewGuid():N}"[..16],
                CreatedAt = Sold,
                CatalogSyncedAt = deviceSynced,
                PaymentMethod = PaymentMethodEnum.Cash,
                AmountReceived = 500m,
                BranchId = shop.Cebu,
            }]), CancellationToken.None);
        return results.Single();
    }

    private static async Task LogBranchPriceAsync(Shop shop, string? oldValue, string? newValue, DateTime at)
    {
        await using var db = shop.Database.CreateContext();
        var key = CatalogHistoryRules.BranchPriceKey(shop.Latte, shop.Cebu);
        db.CatalogChangeLogs.AddRange(
            new CatalogChangeLog { Id = Guid.NewGuid(), TenantId = Tenant, EntityType = CatalogEntityTypes.Baseline, EntityId = Tenant, Field = CatalogHistoryRules.BaselineField, NewValue = "1", EffectiveFrom = Sold.AddYears(-1), CreatedAt = Sold.AddYears(-1) },
            new CatalogChangeLog { Id = Guid.NewGuid(), TenantId = Tenant, EntityType = CatalogEntityTypes.ProductBranchPrice, EntityId = key, Field = "Price", OldValue = oldValue, NewValue = newValue, EffectiveFrom = at, CreatedAt = at });
        await db.SaveChangesAsync();
    }

    [SqlFact]
    public async Task AnOfflineSale_AtTheShopPriceInABranchThatChargesMore_IsHeldForReview()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        var result = await SyncSaleAsync(shop, 160m, null);

        result.Status.ShouldBe(OrderStatusEnum.PendingReview);
        result.ReasonDetails!.Single().Code.ShouldBe(OfflineReasonCodes.PriceChanged);
        result.ReasonDetails!.Single().ExpectedValue.ShouldBe("175.00");
    }

    [SqlFact]
    public async Task AnOfflineSale_AtTheBranchPrice_IsCompleted()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        var result = await SyncSaleAsync(shop, 175m, null);

        result.Status.ShouldBe(OrderStatusEnum.Completed);
    }

    [SqlFact]
    public async Task ABranchPriceChangedAfterTheSale_IsNotAConflict_ButOneChangedBeforeIt_Is()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        await LogBranchPriceAsync(shop, "160.00", "175.00", Sold.AddHours(2));

        (await SyncSaleAsync(shop, 160m, Sold.AddHours(-3))).Status.ShouldBe(OrderStatusEnum.Completed);

        await using (var db = shop.Database.CreateContext())
        {
            db.CatalogChangeLogs.RemoveRange(await db.CatalogChangeLogs.Where(l => l.EntityType == CatalogEntityTypes.ProductBranchPrice).ToListAsync());
            await db.SaveChangesAsync();
        }

        await LogBranchPriceAsync(shop, "160.00", "175.00", Sold.AddHours(-1));
        (await SyncSaleAsync(shop, 160m, Sold.AddHours(-3))).Status.ShouldBe(OrderStatusEnum.PendingReview);
    }
}
