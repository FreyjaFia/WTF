using WTF.Api.Common.Auth;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

public class ProductMarginDatabaseTests
{
    [SqlFact]
    public async Task Handle_ASaleThatTookStock_ShowsTheCostFromItsMovementsOnRealSqlServer()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var latte = await SqlSeed.ProductAsync(database, user.Id, "Latte", 150m);

        await using (var db = database.CreateContext())
        {
            var item = new Item
            {
                Id = Guid.NewGuid(),
                Name = "Milk",
                UnitName = "ml",
                CurrentQuantity = 10000m,
                AverageCost = 0.1m,
                AllowNegativeStock = true,
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
                CreatedBy = user.Id,
            };
            db.Items.Add(item);
            db.ProductItemLinks.Add(new ProductItemLink
            {
                Id = Guid.NewGuid(),
                ProductId = latte.Id,
                ItemId = item.Id,
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
                Items = [new OrderItemRequestDto(latte.Id, 2, [], null, null)],
            }, CancellationToken.None);
        }

        await using var reportDb = database.CreateContext();
        var today = DateTime.UtcNow.Date;
        var handler = new GetProductMarginReportHandler(reportDb, TestRequest.As(user.Id, AppRoles.Admin, "UTC"));
        var rows = await handler.Handle(new GetProductMarginReportQuery { FromDate = today.AddDays(-1), ToDate = today.AddDays(1) }, CancellationToken.None);

        var row = rows.Single();
        row.QuantitySold.ShouldBe(2);
        row.Revenue.ShouldBe(300m);
        row.Cost.ShouldBe(40m);
        row.GrossProfit.ShouldBe(260m);
        row.CostStatus.ShouldBe("Known");
    }
}
