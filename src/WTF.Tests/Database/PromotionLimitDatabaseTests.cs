using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

/// <summary>
/// Limited promotions and the total check against a real SQL Server: a refused sale must leave nothing behind (the
/// in-memory provider ignores transactions), and registers completing sales at the same moment must not take the same use.
/// </summary>
public class PromotionLimitDatabaseTests
{
    private static CreateOrderHandler Handler(WTFDbContext db, Guid userId) =>
        new(db, TestRequest.As(userId, AppRoles.Admin, "UTC"), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(db));

    private static CreateOrderCommand Sale(Guid productId, int quantity = 1, decimal? expected = null) => new()
    {
        Status = OrderStatusEnum.Completed,
        Items = [new OrderItemRequestDto(productId, quantity, [], null, null)],
        ExpectedTotal = expected,
    };

    private static async Task<Guid> LimitedDiscountAsync(SqlTestDatabase database, Guid userId, Guid productId, int max)
    {
        await using var db = database.CreateContext();
        var promo = new Promotion
        {
            Id = Guid.NewGuid(),
            Name = "Last ones",
            TypeId = PromotionTypeIds.DiscountedProduct,
            IsActive = true,
            MaxRedemptions = max,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId,
        };
        promo.DiscountedProductPromotions.Add(new DiscountedProductPromotion
        {
            Id = Guid.NewGuid(),
            PromotionId = promo.Id,
            ProductId = productId,
            PercentOff = 50m,
        });
        db.Promotions.Add(promo);
        await db.SaveChangesAsync();
        return promo.Id;
    }

    [SqlFact]
    public async Task ASaleWhoseTotalMoved_IsRefusedAndRolledBack()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var product = await SqlSeed.ProductAsync(database, user.Id, "Latte", 150m);

        await using (var db = database.CreateContext())
        {
            await Should.ThrowAsync<InvalidOperationException>(() =>
                Handler(db, user.Id).Handle(Sale(product.Id, 1, expected: 100m), CancellationToken.None));
        }

        await using var check = database.CreateContext();
        (await check.Orders.CountAsync()).ShouldBe(0, "the transaction undoes the half-saved order");
        (await check.OrderItems.CountAsync()).ShouldBe(0);
    }

    [SqlFact]
    public async Task ASaleWhoseTotalMatches_IsSaved()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var product = await SqlSeed.ProductAsync(database, user.Id, "Latte", 150m);

        await using (var db = database.CreateContext())
        {
            (await Handler(db, user.Id).Handle(Sale(product.Id, 1, expected: 150m), CancellationToken.None))
                .TotalAmount.ShouldBe(150m);
        }

        await using var check = database.CreateContext();
        (await check.Orders.CountAsync()).ShouldBe(1);
    }

    [SqlFact]
    public async Task SalesCompletedAtTheSameMoment_NeverTakeMoreUsesThanThePromotionHas()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var product = await SqlSeed.ProductAsync(database, user.Id, "Croissant", 100m);
        await LimitedDiscountAsync(database, user.Id, product.Id, max: 3);

        // Ten registers, each with its own connection, all completing one croissant at once.
        var results = await Task.WhenAll(Enumerable.Range(0, 10).Select(async _ =>
        {
            await using var db = database.CreateContext();
            return await Handler(db, user.Id).Handle(Sale(product.Id), CancellationToken.None);
        }));

        results.Count(r => r.TotalAmount == 50m).ShouldBe(3, "exactly the 3 uses the promotion has");
        results.Count(r => r.TotalAmount == 100m).ShouldBe(7);
        await using var check = database.CreateContext();
        (await check.OrderItems.CountAsync(i => i.DiscountPromotionId != null)).ShouldBe(3);
    }

    [SqlFact]
    public async Task OpenOrdersSavedAtTheSameMoment_ShareThePromotionUsesToo()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var product = await SqlSeed.ProductAsync(database, user.Id, "Croissant", 100m);
        await LimitedDiscountAsync(database, user.Id, product.Id, max: 2);

        await Task.WhenAll(Enumerable.Range(0, 6).Select(async _ =>
        {
            await using var db = database.CreateContext();
            await Handler(db, user.Id).Handle(
                new CreateOrderCommand
                {
                    Status = OrderStatusEnum.Pending,
                    Items = [new OrderItemRequestDto(product.Id, 1, [], null, null)],
                },
                CancellationToken.None);
        }));

        await using var check = database.CreateContext();
        (await check.OrderItems.CountAsync(i => i.DiscountPromotionId != null)).ShouldBe(2, "only 2 orders hold a use");
    }
}
