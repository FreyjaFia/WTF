using WTF.Api.Features.Dashboard;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Branches;

public class DashboardNewCustomerBranchTests
{
    private static readonly Guid Tenant = TenantDefaults.DefaultTenantId;
    private static readonly TimeZoneInfo Manila = TimeZoneInfo.FindSystemTimeZoneById("Asia/Manila");

    private readonly string _dbName = TestDb.NewName();
    private readonly Guid _makati;
    private readonly Guid _cebu = Guid.NewGuid();

    public DashboardNewCustomerBranchTests()
    {
        using var db = TestDb.Create(_dbName);
        _makati = db.Branches.Single(b => b.IsMain).Id;
        db.Branches.Add(new Branch { Id = _cebu, TenantId = Tenant, Name = "Cebu", Code = "CEB", TimeZone = "Asia/Manila", IsActive = true, CreatedAt = DateTime.UtcNow });
        db.SaveChanges();
    }

    private static DateTime LocalToday() => TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Manila).Date;

    private static DateTime At(DateTime localDate, int hour) =>
        TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(localDate.Date.AddHours(hour), DateTimeKind.Unspecified), Manila);

    private static void InBranchOrder(WTFDbContext db, DateTime createdAtUtc, Guid customerId, Guid branchId)
    {
        var order = Order(db, createdAtUtc, customerId: customerId);
        order.TenantId = Tenant;
        order.BranchId = branchId;
    }

    [Fact]
    public async Task NewCustomers_ACustomerWhoBoughtAtAnotherBranchBefore_IsReturning()
    {
        var yesterday = LocalToday().AddDays(-1);
        var customer = Guid.NewGuid();
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            db.Customers.Add(new Customer { Id = customer, FirstName = "Maria", LastName = "Santos", IsActive = true });
            InBranchOrder(db, At(yesterday.AddDays(-10), 12), customer, _cebu);
            InBranchOrder(db, At(yesterday, 12), customer, _makati);
            await db.SaveChangesAsync();
        }

        await using var scoped = TestDb.Create(_dbName, new FixedTenant(Tenant), new FixedBranch([_makati], _makati, true));
        var handler = new GetDashboardHandler(scoped, TestRequest.As(Guid.NewGuid(), timeZone: "Asia/Manila"), TestFakes.Features);

        var insights = (await handler.Handle(new GetDashboardQuery("yesterday", null, null), default)).Insights!;

        insights.NewCustomers.ShouldBe(0);
        insights.ReturningCustomers.ShouldBe(1);
    }
}
