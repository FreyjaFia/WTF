using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

public class OrderItemQuantityCheckTests
{
    [SqlTheory]
    [InlineData(1)]
    [InlineData(9999)]
    public async Task QuantityInRange_IsSaved(int quantity)
    {
        await using var database = await SqlTestDatabase.CreateAsync();

        await SaveItemAsync(database, quantity);
    }

    [SqlTheory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(10000)]
    public async Task QuantityOutOfRange_IsRejected(int quantity)
    {
        await using var database = await SqlTestDatabase.CreateAsync();

        var error = await Should.ThrowAsync<SqlException>(() => SaveItemAsync(database, quantity));

        error.Message.ShouldContain("CK_OrderItems_Quantity_Range");
    }

    private static async Task SaveItemAsync(SqlTestDatabase database, int quantity)
    {
        var user = await SqlSeed.UserAsync(database);
        var product = await SqlSeed.ProductAsync(database, user.Id, "Latte", 100m);

        await using var db = database.CreateContext(new FixedTenant(TenantDefaults.DefaultTenantId));
        var order = new Order
        {
            Id = Guid.NewGuid(),
            CreatedAt = DateTime.UtcNow,
            CreatedBy = user.Id,
            StatusId = (int)OrderStatusEnum.Completed,
        };
        db.Orders.Add(order);
        await db.SaveChangesAsync();

        // Saved as 1 first: EF treats 0 as "not set" for a column with a default of 1 and would store the default.
        var item = new OrderItem { Id = Guid.NewGuid(), OrderId = order.Id, ProductId = product.Id, Quantity = 1 };
        db.OrderItems.Add(item);
        await db.SaveChangesAsync();

        await db.OrderItems.Where(i => i.Id == item.Id).ExecuteUpdateAsync(s => s.SetProperty(i => i.Quantity, quantity));
    }
}
