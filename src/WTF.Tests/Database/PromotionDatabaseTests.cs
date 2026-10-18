using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Promotions;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

/// <summary>Fixed bundle promotions against a real SQL Server: nested rows, foreign keys and the order references.</summary>
public class PromotionDatabaseTests
{
    private static UpdateFixedBundlePromotionHandler Update(WTF.Domain.Data.WTFDbContext db, Guid userId) =>
        new(db, TestRequest.As(userId, AppRoles.Admin));

    private static UpdateFixedBundlePromotionCommand Cmd(Guid promotionId, params CreateFixedBundlePromotionItemRequestDto[] items) =>
        new() { PromotionId = promotionId, Name = "Renamed", BundlePrice = 70m, IsActive = false, Items = [.. items] };

    [SqlFact]
    public async Task Update_ReplacesItemsAndAddOns_WhileOrdersStillReferenceThePromotion()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var burger = await SqlSeed.ProductAsync(database, user.Id, "Burger", 100m);
        var fries = await SqlSeed.ProductAsync(database, user.Id, "Fries", 50m);
        var cheese = await SqlSeed.ProductAsync(database, user.Id, "Cheese", 10m);
        await DbOrderSeed.LinkAddOnAsync(database, fries.Id, cheese.Id);
        var promo = await DbOrderSeed.FixedBundleAsync(database, user.Id, burger.Id);
        var orderId = await DbOrderSeed.OrderAsync(database, user.Id);
        await DbOrderSeed.BundleOnOrderAsync(database, orderId, promo, 90m);

        await using (var db = database.CreateContext())
        {
            var dto = await Update(db, user.Id).Handle(
                Cmd(promo, new CreateFixedBundlePromotionItemRequestDto(fries.Id, 2,
                    [new CreateFixedBundlePromotionItemAddOnRequestDto(cheese.Id, 1)])),
                CancellationToken.None);
            dto.ShouldNotBeNull();
        }

        await using var check = database.CreateContext();
        var items = await check.FixedBundlePromotionItems.ToListAsync();
        items.Single().ProductId.ShouldBe(fries.Id);
        items.Single().Quantity.ShouldBe(2);
        (await check.FixedBundlePromotionItemAddOns.SingleAsync()).AddOnProductId.ShouldBe(cheese.Id);
        // The order keeps pointing at the same promotion and the price it was sold at.
        var orderBundle = await check.OrderBundlePromotions.SingleAsync();
        orderBundle.PromotionId.ShouldBe(promo);
        orderBundle.UnitPrice.ShouldBe(90m);
    }

    [SqlFact]
    public async Task Update_ItemWithAnUnknownProduct_IsRejectedWithAClearMessageAndKeepsTheOldRows()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var burger = await SqlSeed.ProductAsync(database, user.Id, "Burger", 100m);
        var promo = await DbOrderSeed.FixedBundleAsync(database, user.Id, burger.Id, 90m);

        // The handler checks that every bundle product exists before touching any rows.
        await using (var db = database.CreateContext())
        {
            var ex = await Should.ThrowAsync<InvalidOperationException>(() => Update(db, user.Id).Handle(
                Cmd(promo, new CreateFixedBundlePromotionItemRequestDto(Guid.NewGuid(), 1, [])), CancellationToken.None));
            ex.Message.ShouldBe("One or more promotion products or add-ons do not exist.");
        }

        await using var check = database.CreateContext();
        var saved = await check.Promotions.Include(p => p.FixedBundlePromotion!).ThenInclude(f => f.FixedBundlePromotionItems).SingleAsync();
        saved.Name.ShouldBe("Combo");
        saved.IsActive.ShouldBeTrue();
        saved.UpdatedAt.ShouldBeNull();
        saved.FixedBundlePromotion!.BundlePrice.ShouldBe(90m);
        saved.FixedBundlePromotion.FixedBundlePromotionItems.Single().ProductId.ShouldBe(burger.Id);
    }

    [SqlFact]
    public async Task Delete_PromotionReferencedByOrders_IsOnlyDeactivated()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var burger = await SqlSeed.ProductAsync(database, user.Id, "Burger", 100m);
        var promo = await DbOrderSeed.FixedBundleAsync(database, user.Id, burger.Id);
        var orderId = await DbOrderSeed.OrderAsync(database, user.Id);
        await DbOrderSeed.BundleOnOrderAsync(database, orderId, promo);

        await using (var db = database.CreateContext())
        {
            var handler = new DeleteFixedBundlePromotionHandler(db, TestRequest.As(user.Id, AppRoles.Admin));
            (await handler.Handle(new DeleteFixedBundlePromotionCommand(promo), CancellationToken.None)).ShouldBeTrue();
        }

        await using var check = database.CreateContext();
        (await check.Promotions.SingleAsync()).IsActive.ShouldBeFalse();
        (await check.FixedBundlePromotionItems.CountAsync()).ShouldBe(1);
        (await check.OrderBundlePromotions.CountAsync()).ShouldBe(1);
    }
}
