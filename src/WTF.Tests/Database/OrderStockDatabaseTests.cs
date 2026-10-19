using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Items;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

/// <summary>
/// Order-time stock against a real SQL Server: the guarded balance update, the rollback of a refused sale and registers
/// completing sales at the same moment. The in-memory provider shows none of them.
/// </summary>
public class OrderStockDatabaseTests
{
    private static CreateOrderHandler Handler(WTFDbContext db, Guid userId) =>
        new(db, TestRequest.As(userId, AppRoles.Admin, "UTC"), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(db));

    private static CreateOrderCommand Sale(Guid productId, int quantity = 1, bool honor = false) => new()
    {
        Status = OrderStatusEnum.Completed,
        Items = [new OrderItemRequestDto(productId, quantity, [], null, null)],
        HonorStock = honor,
    };

    private static async Task<Item> ItemAsync(SqlTestDatabase database, Guid userId, string name, decimal quantity, bool allowNegative)
    {
        await using var db = database.CreateContext();
        var item = new Item
        {
            Id = Guid.NewGuid(),
            Name = name,
            UnitName = "ml",
            CurrentQuantity = quantity,
            AllowNegativeStock = allowNegative,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId,
        };
        db.Items.Add(item);
        await db.SaveChangesAsync();
        return item;
    }

    private static async Task LinkAsync(SqlTestDatabase database, Guid userId, Guid productId, Guid itemId, decimal quantityPerSale)
    {
        await using var db = database.CreateContext();
        db.ProductItemLinks.Add(new ProductItemLink
        {
            Id = Guid.NewGuid(),
            ProductId = productId,
            ItemId = itemId,
            QuantityPerSale = quantityPerSale,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId,
        });
        await db.SaveChangesAsync();
    }

    [SqlFact]
    public async Task Create_CompletedSale_DeductsAndWritesTheMovementWithItsColumns()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var latte = await SqlSeed.ProductAsync(database, user.Id, "Latte", 150m);
        var milk = await ItemAsync(database, user.Id, "Oat Milk", 10000m, true);
        await LinkAsync(database, user.Id, latte.Id, milk.Id, 200m);

        OrderDto dto;
        await using (var db = database.CreateContext())
        {
            dto = await Handler(db, user.Id).Handle(Sale(latte.Id, 3), CancellationToken.None);
        }

        await using var check = database.CreateContext();
        (await check.Items.SingleAsync()).CurrentQuantity.ShouldBe(9400m);
        var movement = await check.StockMovements.SingleAsync();
        movement.MovementType.ShouldBe("Sale");
        movement.ProductId.ShouldBe(latte.Id);
        movement.ReferenceId.ShouldBe(dto.Id);
        movement.OrderItemId.ShouldNotBeNull();
    }

    [SqlFact]
    public async Task Create_BlockingItemShort_RefusesAndLeavesNoOrderAndNoMovement()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var latte = await SqlSeed.ProductAsync(database, user.Id, "Latte", 150m);
        var cup = await ItemAsync(database, user.Id, "Cup", 1m, false);
        var milk = await ItemAsync(database, user.Id, "Milk", 1000m, true);
        await LinkAsync(database, user.Id, latte.Id, milk.Id, 200m);
        await LinkAsync(database, user.Id, latte.Id, cup.Id, 1m);

        await using (var db = database.CreateContext())
        {
            var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
                Handler(db, user.Id).Handle(Sale(latte.Id, 2), CancellationToken.None));
            ex.Message.ShouldContain("Cup");
        }

        // The milk had already been taken when the cup refused, and the transaction put it back with the order.
        await using var check = database.CreateContext();
        (await check.Orders.CountAsync()).ShouldBe(0);
        (await check.StockMovements.CountAsync()).ShouldBe(0);
        (await check.Items.SingleAsync(i => i.Name == "Milk")).CurrentQuantity.ShouldBe(1000m);
        (await check.Items.SingleAsync(i => i.Name == "Cup")).CurrentQuantity.ShouldBe(1m);
    }

    [SqlFact]
    public async Task Create_AnOfflineSaleOnABlockingItem_GoesBelowZeroInsteadOfRefusing()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var latte = await SqlSeed.ProductAsync(database, user.Id, "Latte", 150m);
        var cup = await ItemAsync(database, user.Id, "Cup", 1m, false);
        await LinkAsync(database, user.Id, latte.Id, cup.Id, 1m);

        await using (var db = database.CreateContext())
        {
            var dto = await Handler(db, user.Id).Handle(Sale(latte.Id, 3, honor: true), CancellationToken.None);
            dto.StockWarnings!.Single().ShouldContain("Cup is below zero");
        }

        await using var check = database.CreateContext();
        (await check.Items.SingleAsync()).CurrentQuantity.ShouldBe(-2m);
    }

    [SqlFact]
    public async Task Create_ManyRegistersAtOnce_NeverLoseADeductionAndNeverOversellABlockingItem()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var latte = await SqlSeed.ProductAsync(database, user.Id, "Latte", 150m);
        var cup = await ItemAsync(database, user.Id, "Cup", 6m, false);
        await LinkAsync(database, user.Id, latte.Id, cup.Id, 1m);

        // Ten registers each sell one latte; only six cups exist.
        var results = await Task.WhenAll(Enumerable.Range(0, 10).Select(async _ =>
        {
            await using var db = database.CreateContext();
            try
            {
                await Handler(db, user.Id).Handle(Sale(latte.Id), CancellationToken.None);
                return true;
            }
            catch (InvalidOperationException)
            {
                return false;
            }
        }));

        results.Count(sold => sold).ShouldBe(6);
        await using var check = database.CreateContext();
        (await check.Items.SingleAsync()).CurrentQuantity.ShouldBe(0m);
        (await check.StockMovements.CountAsync()).ShouldBe(6);
        (await check.Orders.CountAsync()).ShouldBe(6);
    }

    [SqlFact]
    public async Task StockIn_WhileSalesComplete_KeepsEveryChange()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var latte = await SqlSeed.ProductAsync(database, user.Id, "Latte", 150m);
        var milk = await ItemAsync(database, user.Id, "Milk", 1000m, true);
        await LinkAsync(database, user.Id, latte.Id, milk.Id, 100m);

        await Task.WhenAll(Enumerable.Range(0, 5).SelectMany(_ => new Func<Task>[]
        {
            async () =>
            {
                await using var db = database.CreateContext();
                await Handler(db, user.Id).Handle(Sale(latte.Id), CancellationToken.None);
            },
            async () =>
            {
                await using var db = database.CreateContext();
                await new AddItemStockHandler(db, TestRequest.As(user.Id, AppRoles.Admin), TestFakes.Audit())
                    .Handle(new AddItemStockCommand { ItemId = milk.Id, Quantity = 50m }, CancellationToken.None);
            }
        }).Select(run => run()));

        // 1000 - 5 x 100 + 5 x 50
        await using var check = database.CreateContext();
        (await check.Items.SingleAsync()).CurrentQuantity.ShouldBe(750m);
    }
}
