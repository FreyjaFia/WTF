using WTF.Api.Common.Auth;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

public class MenuEngineeringDatabaseTests
{
    [SqlFact]
    public async Task Handle_RatesAProductWithAFullCost_AndLeavesOneWithoutUnrated_OnRealSqlServer()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var latte = await SqlSeed.ProductAsync(database, user.Id, "Latte", 150m);
        var cookie = await SqlSeed.ProductAsync(database, user.Id, "Cookie", 100m);
        var milkId = Guid.NewGuid();

        await using (var db = database.CreateContext())
        {
            db.Items.Add(new Item
            {
                Id = milkId,
                Name = "Milk",
                UnitName = "ml",
                CurrentQuantity = 10000m,
                AverageCost = 0.1m,
                AllowNegativeStock = true,
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
                CreatedBy = user.Id,
            });
            db.ProductItemLinks.Add(new ProductItemLink
            {
                Id = Guid.NewGuid(),
                ProductId = latte.Id,
                ItemId = milkId,
                QuantityPerSale = 200m,
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
                CreatedBy = user.Id,
            });
            await db.SaveChangesAsync();
        }

        await using (var db = database.CreateContext())
        {
            var create = new CreateOrderHandler(db, TestRequest.As(user.Id, AppRoles.Admin, "UTC"), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(db));
            await create.Handle(new CreateOrderCommand
            {
                Status = OrderStatusEnum.Completed,
                Items = [new OrderItemRequestDto(latte.Id, 3, [], null, null), new OrderItemRequestDto(cookie.Id, 1, [], null, null)],
            }, CancellationToken.None);
        }

        await using var reportDb = database.CreateContext();
        var today = DateTime.UtcNow.Date;
        var handler = new GetMenuEngineeringReportHandler(reportDb, TestRequest.As(user.Id, AppRoles.Admin, "UTC"));
        var rows = (await handler.Handle(new GetMenuEngineeringReportQuery { FromDate = today.AddDays(-1), ToDate = today.AddDays(1) }, CancellationToken.None))
            .ToDictionary(r => r.ProductName);

        rows["Latte"].MenuClass.ShouldBe("Star");
        rows["Latte"].UnitProfit.ShouldBe(130m);
        rows["Latte"].PopularityPercent.ShouldBe(100m);
        rows["Cookie"].MenuClass.ShouldBe("Not rated");
    }
}
