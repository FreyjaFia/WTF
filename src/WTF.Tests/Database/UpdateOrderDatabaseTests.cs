using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

/// <summary>Order, line and promotion rows the order/promotion database tests share. Foreign keys are real, so parents come first.</summary>
internal static class DbOrderSeed
{
    public static async Task<Guid> OrderAsync(SqlTestDatabase database, Guid userId, OrderStatusEnum status = OrderStatusEnum.Pending,
        string? note = null, int? orderNumber = null)
    {
        await using var db = database.CreateContext();
        var order = new Order
        {
            Id = Guid.NewGuid(),
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId,
            StatusId = (int)status,
            Note = note,
        };
        if (orderNumber.HasValue)
        {
            order.OrderNumber = orderNumber.Value;
        }

        db.Orders.Add(order);
        await db.SaveChangesAsync();
        return order.Id;
    }

    public static async Task<Guid> LineAsync(SqlTestDatabase database, Guid orderId, Guid productId, int quantity = 1,
        int sortOrder = 0, Guid? parentId = null, decimal? price = null)
    {
        await using var db = database.CreateContext();
        var line = new OrderItem
        {
            Id = Guid.NewGuid(),
            OrderId = orderId,
            ProductId = productId,
            Quantity = quantity,
            SortOrder = sortOrder,
            ParentOrderItemId = parentId,
            Price = price,
        };
        db.OrderItems.Add(line);
        await db.SaveChangesAsync();
        return line.Id;
    }

    public static async Task BundleOnOrderAsync(SqlTestDatabase database, Guid orderId, Guid promotionId, decimal unitPrice = 90m)
    {
        await using var db = database.CreateContext();
        db.OrderBundlePromotions.Add(new OrderBundlePromotion
        {
            OrderId = orderId,
            PromotionId = promotionId,
            Quantity = 1,
            UnitPrice = unitPrice,
        });
        await db.SaveChangesAsync();
    }

    public static async Task<Guid> FixedBundleAsync(SqlTestDatabase database, Guid userId, Guid productId, decimal bundlePrice = 90m)
    {
        await using var db = database.CreateContext();
        var promotion = new Promotion
        {
            Id = Guid.NewGuid(),
            Name = "Combo",
            TypeId = PromotionTypeIds.FixedBundle,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId,
        };
        promotion.FixedBundlePromotion = new FixedBundlePromotion { Promotion = promotion, BundlePrice = bundlePrice };
        promotion.FixedBundlePromotion.FixedBundlePromotionItems.Add(new FixedBundlePromotionItem { ProductId = productId, Quantity = 1 });
        db.Promotions.Add(promotion);
        await db.SaveChangesAsync();
        return promotion.Id;
    }

    public static async Task LinkAddOnAsync(SqlTestDatabase database, Guid productId, Guid addOnId)
    {
        await using var db = database.CreateContext();
        db.ProductAddOns.Add(new ProductAddOn { ProductId = productId, AddOnId = addOnId, AddOnTypeId = 1, IsActive = true });
        await db.SaveChangesAsync();
    }
}

/// <summary>
/// Updating an order against a real SQL Server: the line replace and the order save are one SaveChanges
/// transaction, and the unique index and foreign keys are enforced by the database.
/// </summary>
public class UpdateOrderDatabaseTests
{
    private static UpdateOrderHandler Handler(WTF.Domain.Data.WTFDbContext db, Guid userId) =>
        new(db, TestRequest.As(userId, AppRoles.Admin), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(), TestFakes.Conversations());

    private static OrderItemRequestDto Line(Guid productId, int qty = 1, string? instructions = null, params OrderItemRequestDto[] addOns) =>
        new(productId, qty, [.. addOns], instructions, null);

    private static UpdateOrderCommand Cmd(Guid id, IEnumerable<OrderItemRequestDto> items,
        OrderStatusEnum status = OrderStatusEnum.Pending, string? note = null) =>
        new() { Id = id, Items = [.. items], Status = status, Note = note };

    [SqlFact]
    public async Task Handle_FailureWhileSaving_RollsBackAllLineChanges()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var burger = await SqlSeed.ProductAsync(database, user.Id, "Burger", 100m);
        var fries = await SqlSeed.ProductAsync(database, user.Id, "Fries", 50m);
        var orderId = await DbOrderSeed.OrderAsync(database, user.Id, note: "original");
        var burgerLine = await DbOrderSeed.LineAsync(database, orderId, burger.Id, 1);
        var friesLine = await DbOrderSeed.LineAsync(database, orderId, fries.Id, 2, sortOrder: 1);

        // A rule that exists only in this test database rejects the new line's instructions. The insert then fails
        // after the old lines are already marked for deletion and the order fields changed, in the same SaveChanges.
        // (Over-long text no longer works for this: the handler rejects it up front with a clear message.)
        await using (var db = database.CreateContext())
        {
            await db.Database.ExecuteSqlRawAsync(
                "ALTER TABLE dbo.OrderItems ADD CONSTRAINT CK_Test_NoBoom CHECK (SpecialInstructions IS NULL OR SpecialInstructions <> 'boom')");
        }

        await using (var db = database.CreateContext())
        {
            var cmd = Cmd(orderId, [Line(fries.Id, 5, "boom")], OrderStatusEnum.Completed, note: "changed");
            var ex = await Should.ThrowAsync<DbUpdateException>(() => Handler(db, user.Id).Handle(cmd, CancellationToken.None));
            ex.InnerException.ShouldNotBeNull();
        }

        await using var check = database.CreateContext();
        var lines = await check.OrderItems.Where(i => i.OrderId == orderId).OrderBy(i => i.SortOrder).ToListAsync();
        lines.Select(l => l.Id).ShouldBe([burgerLine, friesLine]);
        lines.ShouldAllBe(l => l.Price == null);
        lines[1].Quantity.ShouldBe(2);
        var order = await check.Orders.SingleAsync();
        order.StatusId.ShouldBe((int)OrderStatusEnum.Pending);
        order.Note.ShouldBe("original");
        order.UpdatedAt.ShouldBeNull();
    }

    [SqlFact]
    public async Task Handle_ParentAndAddOnLines_AreReplacedTogetherDespiteTheSelfReferencingForeignKey()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var burger = await SqlSeed.ProductAsync(database, user.Id, "Burger", 100m);
        var cheese = await SqlSeed.ProductAsync(database, user.Id, "Cheese", 10m);
        await DbOrderSeed.LinkAddOnAsync(database, burger.Id, cheese.Id);
        var orderId = await DbOrderSeed.OrderAsync(database, user.Id);
        var oldParent = await DbOrderSeed.LineAsync(database, orderId, burger.Id);
        var oldChild = await DbOrderSeed.LineAsync(database, orderId, cheese.Id, parentId: oldParent);

        OrderDto? dto;
        await using (var db = database.CreateContext())
        {
            dto = await Handler(db, user.Id).Handle(
                Cmd(orderId, [Line(burger.Id, 2, null, Line(cheese.Id))]), CancellationToken.None);
        }

        dto.ShouldNotBeNull();
        dto!.TotalAmount.ShouldBe(2 * (100m + 10m));
        await using var check = database.CreateContext();
        var lines = await check.OrderItems.Where(i => i.OrderId == orderId).ToListAsync();
        lines.Count.ShouldBe(2);
        lines.Select(l => l.Id).ShouldNotContain(oldParent);
        lines.Select(l => l.Id).ShouldNotContain(oldChild);
        lines.Single(l => l.ParentOrderItemId != null).ParentOrderItemId.ShouldBe(lines.Single(l => l.ParentOrderItemId == null).Id);
    }

    [SqlFact]
    public async Task Handle_BundlePromotions_AreReplacedAndKeepTheOrderNumber()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var burger = await SqlSeed.ProductAsync(database, user.Id, "Burger", 100m);
        var oldPromo = await DbOrderSeed.FixedBundleAsync(database, user.Id, burger.Id, 80m);
        var newPromo = await DbOrderSeed.FixedBundleAsync(database, user.Id, burger.Id, 70m);
        var orderId = await DbOrderSeed.OrderAsync(database, user.Id);
        await DbOrderSeed.LineAsync(database, orderId, burger.Id);
        await DbOrderSeed.BundleOnOrderAsync(database, orderId, oldPromo, 80m);

        int numberBefore;
        await using (var read = database.CreateContext())
        {
            numberBefore = (await read.Orders.SingleAsync()).OrderNumber;
        }

        await using (var db = database.CreateContext())
        {
            var cmd = Cmd(orderId, [Line(burger.Id)]) with
            {
                BundlePromotions = [new OrderBundlePromotionRequestDto(newPromo, 2)],
            };
            await Handler(db, user.Id).Handle(cmd, CancellationToken.None);
        }

        await using var check = database.CreateContext();
        var bundle = await check.OrderBundlePromotions.SingleAsync();
        bundle.PromotionId.ShouldBe(newPromo);
        bundle.Quantity.ShouldBe(2);
        bundle.UnitPrice.ShouldBe(70m);
        (await check.Orders.SingleAsync()).OrderNumber.ShouldBe(numberBefore);
    }

    [SqlFact]
    public async Task Database_DuplicateOrderNumber_IsRejectedByTheUniqueIndex()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        await DbOrderSeed.OrderAsync(database, user.Id, orderNumber: 500);

        var ex = await Should.ThrowAsync<DbUpdateException>(() =>
            DbOrderSeed.OrderAsync(database, user.Id, orderNumber: 500));

        ex.InnerException!.Message.ShouldContain("UQ_Orders_OrderNumber");
    }

    [SqlFact]
    public async Task Database_ProductStillOnAnOrderLine_CannotBeDeleted()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var burger = await SqlSeed.ProductAsync(database, user.Id, "Burger", 100m);
        var orderId = await DbOrderSeed.OrderAsync(database, user.Id);
        await DbOrderSeed.LineAsync(database, orderId, burger.Id);

        await using (var db = database.CreateContext())
        {
            db.Products.Remove(await db.Products.SingleAsync());
            var ex = await Should.ThrowAsync<DbUpdateException>(() => db.SaveChangesAsync());
            ex.InnerException!.Message.ShouldContain("FK_OrderItems_Product");
        }

        await using var check = database.CreateContext();
        (await check.Products.CountAsync()).ShouldBe(1);
        (await check.OrderItems.CountAsync()).ShouldBe(1);
    }

    [SqlFact]
    public async Task Database_PromotionStillOnAnOrder_CannotBeDeleted()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var burger = await SqlSeed.ProductAsync(database, user.Id, "Burger", 100m);
        var promo = await DbOrderSeed.FixedBundleAsync(database, user.Id, burger.Id);
        var orderId = await DbOrderSeed.OrderAsync(database, user.Id);
        await DbOrderSeed.BundleOnOrderAsync(database, orderId, promo);

        await using (var db = database.CreateContext())
        {
            db.Promotions.Remove(await db.Promotions.SingleAsync());
            var ex = await Should.ThrowAsync<DbUpdateException>(() => db.SaveChangesAsync());
            ex.InnerException!.Message.ShouldContain("FK_OrderBundlePromotions_Promotion");
        }

        await using var check = database.CreateContext();
        (await check.Promotions.CountAsync()).ShouldBe(1);
        (await check.OrderBundlePromotions.CountAsync()).ShouldBe(1);
    }

    [SqlFact]
    public async Task Database_DeletingAnOrderWithLines_CascadesToTheLines()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var burger = await SqlSeed.ProductAsync(database, user.Id, "Burger", 100m);
        var orderId = await DbOrderSeed.OrderAsync(database, user.Id);
        await DbOrderSeed.LineAsync(database, orderId, burger.Id);

        // Raw delete, so the database rule decides rather than EF's client-side cascade.
        await using (var db = database.CreateContext())
        {
            await db.Database.ExecuteSqlRawAsync("DELETE FROM Orders WHERE Id = {0}", orderId);
        }

        await using var check = database.CreateContext();
        (await check.Orders.CountAsync()).ShouldBe(0);
        (await check.OrderItems.CountAsync()).ShouldBe(0);
    }

    [SqlFact]
    public async Task Database_DeletingAnOrderWithBundlePromotions_IsBlockedByTheForeignKey()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var burger = await SqlSeed.ProductAsync(database, user.Id, "Burger", 100m);
        var promo = await DbOrderSeed.FixedBundleAsync(database, user.Id, burger.Id);
        var orderId = await DbOrderSeed.OrderAsync(database, user.Id);
        await DbOrderSeed.BundleOnOrderAsync(database, orderId, promo);

        await using (var db = database.CreateContext())
        {
            var ex = await Should.ThrowAsync<Microsoft.Data.SqlClient.SqlException>(() =>
                db.Database.ExecuteSqlRawAsync("DELETE FROM Orders WHERE Id = {0}", orderId));
            ex.Message.ShouldContain("FK_OrderBundlePromotions_Order");
        }

        await using var check = database.CreateContext();
        (await check.Orders.CountAsync()).ShouldBe(1);
    }
}
