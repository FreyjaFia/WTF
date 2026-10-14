using WTF.Api.Features.OrderLinks;
using WTF.Api.Features.Reports;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Reports;

public class GetVoidedOrdersReportHandlerTests
{
    private static readonly DateTime Noon = Utc(2026, 3, 10, 4);

    private readonly string _dbName = TestDb.NewName();

    private GetVoidedOrdersReportHandler Handler() =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: "Asia/Manila"));

    private static GetVoidedOrdersReportQuery Query() =>
        new() { FromDate = new DateTime(2026, 3, 10), ToDate = new DateTime(2026, 3, 10) };

    [Fact]
    public async Task Handle_NoOrders_ReturnsEmptyList()
    {
        var rows = await Handler().Handle(Query(), default);

        rows.ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_RefundedOrder_ShowsKindReasonWhoVoidedAndLocalTimes()
    {
        Guid refundedId;
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, Noon, 200m);
            var refunded = Sale(db, p, Noon, 50m, Refunded, StaffA);
            refunded.Note = "  customer changed mind ";
            refunded.UpdatedBy = StaffB;
            refunded.UpdatedAt = Utc(2026, 3, 10, 6);
            refundedId = refunded.Id;
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(), default);

        var row = rows.ShouldHaveSingleItem();
        row.OrderId.ShouldBe(refundedId);
        row.Kind.ShouldBe("Refunded");
        row.Amount.ShouldBe(50m);
        row.Reason.ShouldBe("customer changed mind");
        row.StaffName.ShouldBe("Ana Cruz");
        row.VoidedBy.ShouldBe("Ben Reyes");
        row.OrderedAt.ShouldBe(new DateTime(2026, 3, 10, 12, 0, 0));
        row.VoidedAt.ShouldBe(new DateTime(2026, 3, 10, 14, 0, 0));
    }

    [Fact]
    public async Task Handle_RejectedAndCancelledOrders_AreToldApartAndUseTheirOwnReason()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            var rejected = Sale(db, p, Noon, 80m, Cancelled);
            rejected.RejectionReason = "We are closed";
            var cancelled = Sale(db, p, Noon, 60m, Cancelled);
            cancelled.Note = "Duplicate";
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(), default);

        rows.Count.ShouldBe(2);
        var rejectedRow = rows.Single(r => r.Kind == "Rejected");
        rejectedRow.Reason.ShouldBe("We are closed");
        rejectedRow.VoidedBy.ShouldBeNull();
        rows.Single(r => r.Kind == "Cancelled").Reason.ShouldBe("Duplicate");
    }

    [Fact]
    public async Task Handle_StaffVoidRate_IsVoidedShareOfThatStaffsFinishedOrders()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, Noon, 10m, by: StaffA);
            Sale(db, p, Noon, 10m, by: StaffA);
            Sale(db, p, Noon, 10m, by: StaffA);
            Sale(db, p, Noon, 10m, Cancelled, StaffA);
            Sale(db, p, Noon, 10m, Pending, StaffA);
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(), default);

        // The pending order is not finished, so 1 of 4.
        rows.ShouldHaveSingleItem().StaffVoidRate.ShouldBe(25m, 0.0001m);
    }

    [Fact]
    public async Task Handle_CustomerLinkOrders_AreLabelledAndHaveNoVoidedBy()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var system = new User
            {
                Id = Guid.NewGuid(),
                Username = SubmitPublicOrderHandler.SystemUsername,
                PasswordHash = "x",
                FirstName = "Customer",
                LastName = "Link",
            };
            db.Users.Add(system);
            var p = Product(db, "Burger", 100m);
            var order = Sale(db, p, Noon, 40m, Cancelled, system.Id);
            order.UpdatedBy = system.Id;
            order.UpdatedAt = Noon.AddMinutes(5);
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(), default);

        var row = rows.ShouldHaveSingleItem();
        row.StaffName.ShouldBe("Customer link (online)");
        row.VoidedBy.ShouldBeNull();
    }
}
