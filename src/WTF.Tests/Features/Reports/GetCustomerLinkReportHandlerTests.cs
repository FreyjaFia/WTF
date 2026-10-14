using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Reports;

public class GetCustomerLinkReportHandlerTests
{
    private const int PendingApproval = 5;

    private static readonly DateTime Noon = Utc(2026, 3, 10, 4);

    private readonly string _dbName = TestDb.NewName();

    private GetCustomerLinkReportHandler Handler() =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: "Asia/Manila"));

    private static GetCustomerLinkReportQuery Query() =>
        new() { FromDate = new DateTime(2026, 3, 10), ToDate = new DateTime(2026, 3, 10) };

    private static Order LinkOrder(Domain.Data.WTFDbContext db, Product p, Guid linkId, Guid customerId, int status, decimal amount)
    {
        var order = Sale(db, p, Noon, amount, status);
        order.Source = (byte)OrderSourceEnum.CustomerLink;
        order.OrderLinkId = linkId;
        order.CustomerId = customerId;
        return order;
    }

    [Fact]
    public async Task Handle_NoOrders_ReturnsEmptyList()
    {
        var rows = await Handler().Handle(Query(), default);

        rows.ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_PerLink_CountsOutcomesHandoverAndTimings()
    {
        var linkId = Guid.NewGuid();
        var customerId = Guid.NewGuid();
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            db.Statuses.Add(new Status { Id = PendingApproval, Name = "PendingApproval" });
            db.Customers.Add(new Customer { Id = customerId, FirstName = "Maria", LastName = "Santos" });
            var p = Product(db, "Burger", 100m);

            var accepted = LinkOrder(db, p, linkId, customerId, Completed, 100m);
            accepted.AcceptedAt = Noon.AddMinutes(10);
            accepted.ReadyAt = Noon.AddMinutes(25);
            accepted.FulfillmentType = (byte)FulfillmentTypeEnum.Pickup;

            var rejected = LinkOrder(db, p, linkId, customerId, Cancelled, 60m);
            rejected.RejectionReason = "Sold out";
            rejected.FulfillmentType = (byte)FulfillmentTypeEnum.Delivery;

            var waiting = LinkOrder(db, p, linkId, customerId, PendingApproval, 40m);
            waiting.FulfillmentType = (byte)FulfillmentTypeEnum.Delivery;

            Sale(db, p, Noon, 999m); // a shop order, not part of this report
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(), default);

        var row = rows.ShouldHaveSingleItem();
        row.LinkId.ShouldBe(linkId);
        row.CustomerName.ShouldBe("Maria Santos");
        row.OrderCount.ShouldBe(3);
        row.AcceptedCount.ShouldBe(1);
        row.RejectedCount.ShouldBe(1);
        row.AwaitingCount.ShouldBe(1);
        row.PickupCount.ShouldBe(1);
        row.DeliveryCount.ShouldBe(2);
        row.Revenue.ShouldBe(100m);
        row.AverageMinutesToAccept.ShouldBe(10d);
        row.AverageMinutesToReady.ShouldBe(15d);
        row.RejectionReasons.ShouldBe("Sold out");
    }

    [Fact]
    public async Task Handle_NothingAcceptedYet_HasNoAverages()
    {
        var customerId = Guid.NewGuid();
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            db.Customers.Add(new Customer { Id = customerId, FirstName = "Maria", LastName = "Santos" });
            var p = Product(db, "Burger", 100m);
            LinkOrder(db, p, Guid.NewGuid(), customerId, Cancelled, 10m);
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(), default);

        var row = rows.ShouldHaveSingleItem();
        row.AverageMinutesToAccept.ShouldBeNull();
        row.AverageMinutesToReady.ShouldBeNull();
        row.RejectionReasons.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_LongRejectionReasons_AreCut()
    {
        var customerId = Guid.NewGuid();
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            db.Customers.Add(new Customer { Id = customerId, FirstName = "Maria", LastName = "Santos" });
            var p = Product(db, "Burger", 100m);
            var linkId = Guid.NewGuid();
            for (var i = 0; i < 5; i++)
            {
                LinkOrder(db, p, linkId, customerId, Cancelled, 10m).RejectionReason = new string((char)('a' + i), 100);
            }

            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(), default);

        rows.ShouldHaveSingleItem().RejectionReasons!.Length.ShouldBe(200);
    }
}
