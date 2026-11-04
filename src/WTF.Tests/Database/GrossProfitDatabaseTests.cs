using WTF.Api.Common.Auth;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

public class GrossProfitDatabaseTests
{
    [SqlFact]
    public async Task Handle_ASaleAndAWasteEntry_GiveTheoreticalAndActualProfitOnRealSqlServer()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var latte = await SqlSeed.ProductAsync(database, user.Id, "Latte", 150m);
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
                Items = [new OrderItemRequestDto(latte.Id, 2, [], null, null)],
            }, CancellationToken.None);

            db.StockMovements.Add(new StockMovement
            {
                Id = Guid.NewGuid(),
                ItemId = milkId,
                MovementType = StockMovementTypes.Waste,
                QuantityDelta = -100m,
                QuantityBefore = 9600m,
                QuantityAfter = 9500m,
                UnitCost = 0.1m,
                ReferenceType = StockMovementTypes.StockWasteReference,
                ReferenceId = Guid.NewGuid(),
                CreatedAt = DateTime.UtcNow,
                CreatedBy = user.Id,
            });
            await db.SaveChangesAsync();
        }

        await using var reportDb = database.CreateContext();
        var today = DateTime.UtcNow.Date;
        var handler = new GetGrossProfitReportHandler(reportDb, TestRequest.As(user.Id, AppRoles.Admin, "UTC"));
        var rows = await handler.Handle(new GetGrossProfitReportQuery { FromDate = today.AddDays(-1), ToDate = today.AddDays(1) }, CancellationToken.None);

        var row = rows.Single();
        row.NetSales.ShouldBe(300m);
        row.Cost.ShouldBe(40m);
        row.TheoreticalProfit.ShouldBe(260m);
        row.WasteCost.ShouldBe(10m);
        row.ActualProfit.ShouldBe(250m);
        row.CostStatus.ShouldBe("Known");
    }
}
