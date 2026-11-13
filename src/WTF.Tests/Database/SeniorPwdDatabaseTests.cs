using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

/// <summary>The Senior/PWD discount against a real SQL Server: foreign keys, column defaults and the tenant filter.</summary>
public class SeniorPwdDatabaseTests
{
    private static readonly Guid TenantA = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
    private static readonly Guid TenantB = Guid.Parse("bbbbbbbb-0000-0000-0000-000000000002");

    private static CreateOrderHandler CreateHandler(WTFDbContext db, Guid userId) =>
        new(db, TestRequest.As(userId, AppRoles.Cashier), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(db));

    private static UpdateOrderHandler UpdateHandler(WTFDbContext db, Guid userId) =>
        new(db, TestRequest.As(userId, AppRoles.Admin), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(db));

    private static async Task TurnOnAsync(SqlTestDatabase database, bool vatRegistered)
    {
        await using var db = database.CreateContext();
        db.TenantSettings.Add(new TenantSetting
        {
            TenantId = TenantDefaults.DefaultTenantId,
            ShopName = "WTF",
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

    private static CreateOrderCommand Sale(Guid productId, OrderStatusEnum status, decimal? expectedTotal = null) => new()
    {
        Status = status,
        ExpectedTotal = expectedTotal,
        Items = [new OrderItemRequestDto(productId, 1, [], null, null, SeniorPwdPersonIndex: 0)],
        SeniorPwdPersons = [new SeniorPwdPersonRequestDto(SeniorPwdTypeEnum.Senior, "SC-123456", "Lola Remedios")],
    };

    [SqlFact]
    public async Task Create_CompletedVatRegisteredSale_SavesThePersonRowAndTheLineAmounts()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var product = await SqlSeed.ProductAsync(database, user.Id, "Latte", 100m);
        await TurnOnAsync(database, vatRegistered: true);

        await using (var db = database.CreateContext())
        {
            var dto = await CreateHandler(db, user.Id).Handle(Sale(product.Id, OrderStatusEnum.Completed, 71.43m), CancellationToken.None);
            dto.TotalAmount.ShouldBe(71.43m);
        }

        await using var check = database.CreateContext();
        var person = await check.OrderSeniorPwdDiscounts.SingleAsync();
        person.CoveredAmount.ShouldBe(100m);
        person.VatExemptAmount.ShouldBe(10.71m);
        person.DiscountAmount.ShouldBe(17.86m);
        person.RecordedBy.ShouldBe(user.Id);
        var line = await check.OrderItems.SingleAsync();
        line.SeniorPwdDiscountId.ShouldBe(person.Id);
        line.SeniorPwdVatExempt.ShouldBe(10.71m);
        line.SeniorPwdDiscount.ShouldBe(17.86m);
    }

    [SqlFact]
    public async Task Update_RemovingThePerson_DeletesTheRowWithoutBreakingTheForeignKeys()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var product = await SqlSeed.ProductAsync(database, user.Id, "Latte", 100m);
        await TurnOnAsync(database, vatRegistered: false);

        Guid orderId;
        await using (var db = database.CreateContext())
        {
            orderId = (await CreateHandler(db, user.Id).Handle(Sale(product.Id, OrderStatusEnum.Pending), CancellationToken.None)).Id;
        }

        await using (var db = database.CreateContext())
        {
            var dto = await UpdateHandler(db, user.Id).Handle(
                new UpdateOrderCommand
                {
                    Id = orderId,
                    Status = OrderStatusEnum.Pending,
                    Items = [new OrderItemRequestDto(product.Id, 1, [], null, null)],
                },
                CancellationToken.None);
            dto!.TotalAmount.ShouldBe(100m);
        }

        await using var check = database.CreateContext();
        (await check.OrderSeniorPwdDiscounts.CountAsync()).ShouldBe(0);
        (await check.OrderItems.SingleAsync()).SeniorPwdDiscountId.ShouldBeNull();
    }

    [SqlFact]
    public async Task Product_EligibilityDefaultsToOn_AndOffIsSaved()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var latte = await SqlSeed.ProductAsync(database, user.Id, "Latte", 100m);
        var mug = await SqlSeed.ProductAsync(database, user.Id, "Mug", 250m);

        await using (var db = database.CreateContext())
        {
            (await db.Products.FindAsync(mug.Id))!.IsSeniorPwdEligible = false;
            await db.SaveChangesAsync();
        }

        await using var check = database.CreateContext();
        (await check.Products.FindAsync(latte.Id))!.IsSeniorPwdEligible.ShouldBeTrue();
        (await check.Products.FindAsync(mug.Id))!.IsSeniorPwdEligible.ShouldBeFalse();
    }

    [SqlFact]
    public async Task Product_CreatedWithEligibilityOff_KeepsItOff()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);

        await using (var db = database.CreateContext())
        {
            db.Products.Add(new Product
            {
                Id = Guid.NewGuid(),
                Name = "Mug",
                Code = "MUG",
                Price = 250m,
                IsActive = true,
                CategoryId = 1,
                IsSeniorPwdEligible = false,
                CreatedAt = DateTime.UtcNow,
                CreatedBy = user.Id,
            });
            await db.SaveChangesAsync();
        }

        await using var check = database.CreateContext();
        (await check.Products.SingleAsync(p => p.Code == "MUG")).IsSeniorPwdEligible.ShouldBeFalse();
    }

    [SqlFact]
    public async Task Multi_TenantANeverReadsTenantBSeniorPwdRows()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        await using (var db = database.CreateContext())
        {
            db.Tenants.AddRange(
                new Tenant { Id = TenantA, Name = "Shop A", Slug = "shop-a", Status = 2, CreatedAt = DateTime.UtcNow },
                new Tenant { Id = TenantB, Name = "Shop B", Slug = "shop-b", Status = 2, CreatedAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
        }

        var orderA = await SeedOrderWithPersonAsync(database, TenantA, user.Id, "SC-A");
        await SeedOrderWithPersonAsync(database, TenantB, user.Id, "SC-B");

        await using var readA = database.CreateContext(new FixedTenant(TenantA));
        (await readA.OrderSeniorPwdDiscounts.Select(s => s.IdNumber).ToListAsync()).ShouldBe(["SC-A"]);
        (await readA.OrderSeniorPwdDiscounts.Select(s => s.OrderId).SingleAsync()).ShouldBe(orderA);
        await using var readB = database.CreateContext(new FixedTenant(TenantB));
        (await readB.OrderSeniorPwdDiscounts.Select(s => s.IdNumber).ToListAsync()).ShouldBe(["SC-B"]);
    }

    private static async Task<Guid> SeedOrderWithPersonAsync(SqlTestDatabase database, Guid tenantId, Guid userId, string idNumber)
    {
        await using var db = database.CreateContext(new FixedTenant(tenantId));
        var order = new Order
        {
            Id = Guid.NewGuid(),
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId,
            StatusId = (int)OrderStatusEnum.Completed,
        };
        db.Orders.Add(order);
        await db.SaveChangesAsync();
        db.OrderSeniorPwdDiscounts.Add(new OrderSeniorPwdDiscount
        {
            Id = Guid.NewGuid(),
            OrderId = order.Id,
            Type = (byte)SeniorPwdTypeEnum.Senior,
            IdNumber = idNumber,
            CustomerName = "Lola",
            CoveredAmount = 100m,
            DiscountAmount = 20m,
            RecordedBy = userId,
            CreatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
        return order.Id;
    }

    private sealed class FixedTenant(Guid id) : ICurrentTenant
    {
        public bool FilterEnabled => true;

        public Guid? TenantId => id;

        public Guid? StampTenantId => id;
    }
}
