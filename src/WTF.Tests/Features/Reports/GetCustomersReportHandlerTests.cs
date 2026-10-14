using WTF.Api.Features.Reports;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Reports;

public class GetCustomersReportHandlerTests
{
    private static readonly DateTime Noon = Utc(2026, 3, 10, 4);

    private readonly string _dbName = TestDb.NewName();

    private GetCustomersReportHandler Handler() =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: "Asia/Manila"));

    private static GetCustomersReportQuery Query() =>
        new() { FromDate = new DateTime(2026, 3, 10), ToDate = new DateTime(2026, 3, 10) };

    private static Customer AddCustomer(Domain.Data.WTFDbContext db, Guid id, string first, string last)
    {
        var customer = new Customer { Id = id, FirstName = first, LastName = last, IsActive = true };
        db.Customers.Add(customer);
        return customer;
    }

    [Fact]
    public async Task Handle_NoOrders_ReturnsEmptyList()
    {
        var rows = await Handler().Handle(Query(), default);

        rows.ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_NewAndReturningCustomers_AreToldApartByTheirFirstEverSale()
    {
        var maria = Guid.NewGuid();
        var jose = Guid.NewGuid();
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            AddCustomer(db, maria, "Maria", "Santos");
            AddCustomer(db, jose, "Jose", "Rizal");
            var p = Product(db, "Burger", 100m);

            Order(db, Noon, customerId: maria);
            Item(db, db.Orders.Local.Last(), p, 1, 100m);
            Order(db, Noon.AddHours(1), customerId: maria);
            Item(db, db.Orders.Local.Last(), p, 1, 50m);

            Order(db, Utc(2026, 2, 1, 4), customerId: jose);
            Item(db, db.Orders.Local.Last(), p, 1, 10m);
            Order(db, Noon, customerId: jose);
            Item(db, db.Orders.Local.Last(), p, 1, 30m);

            db.LoyaltyPoints.Add(new LoyaltyPoint { Id = Guid.NewGuid(), CustomerId = maria, Points = 30 });
            db.LoyaltyPoints.Add(new LoyaltyPoint { Id = Guid.NewGuid(), CustomerId = maria, Points = 20 });
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(), default);

        rows.Select(r => r.CustomerName).ShouldBe(["Maria Santos", "Jose Rizal"]);
        var mariaRow = rows[0];
        mariaRow.OrderCount.ShouldBe(2);
        mariaRow.TotalSpent.ShouldBe(150m);
        mariaRow.AverageOrderValue.ShouldBe(75m);
        mariaRow.IsNew.ShouldBeTrue();
        mariaRow.LoyaltyPoints.ShouldBe(50);
        mariaRow.LastVisit.ShouldBe(new DateTime(2026, 3, 10, 13, 0, 0));

        var joseRow = rows[1];
        joseRow.IsNew.ShouldBeFalse();
        joseRow.OrderCount.ShouldBe(1);
        joseRow.TotalSpent.ShouldBe(30m);
        joseRow.LoyaltyPoints.ShouldBe(0);
    }

    [Fact]
    public async Task Handle_OrdersWithoutCustomerOrNotCompleted_AreIgnored()
    {
        var maria = Guid.NewGuid();
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            AddCustomer(db, maria, "Maria", "Santos");
            var p = Product(db, "Burger", 100m);
            Sale(db, p, Noon, 500m); // no customer
            Sale(db, p, Noon, 500m, Cancelled).CustomerId = maria;
            Sale(db, p, Noon, 500m, Refunded).CustomerId = maria;
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(), default);

        rows.ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_LastVisit_IsNotLimitedToTheChosenRange()
    {
        var maria = Guid.NewGuid();
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            AddCustomer(db, maria, "Maria", "Santos");
            var p = Product(db, "Burger", 100m);
            Sale(db, p, Noon, 10m).CustomerId = maria;
            Sale(db, p, Utc(2026, 4, 20, 4), 10m).CustomerId = maria;
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(), default);

        rows.ShouldHaveSingleItem().LastVisit.ShouldBe(new DateTime(2026, 4, 20, 12, 0, 0));
    }
}
