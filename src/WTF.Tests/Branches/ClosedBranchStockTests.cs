using WTF.Api.Features.Inventory;
using WTF.Api.Features.Reports;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Branches;

public class ClosedBranchStockTests
{
    private static readonly Guid Tenant = TenantDefaults.DefaultTenantId;

    private readonly string _dbName = TestDb.NewName();
    private readonly Guid _makati;
    private readonly Guid _cebu = Guid.NewGuid();

    public ClosedBranchStockTests()
    {
        using var db = TestDb.Create(_dbName);
        _makati = db.Branches.Single(b => b.IsMain).Id;
        db.Branches.Add(new Branch { Id = _cebu, TenantId = Tenant, Name = "Cebu", Code = "CEB", TimeZone = "Asia/Manila", IsActive = false, CreatedAt = DateTime.UtcNow });
        var item = new Item { Id = Guid.NewGuid(), TenantId = Tenant, Name = "Fresh Milk", UnitName = "ml", IsActive = true, CurrentQuantity = 5000m, WarningQuantity = 1000m, CriticalQuantity = 500m };
        db.Items.Add(item);
        db.ItemBranchStocks.Add(new ItemBranchStock { Id = Guid.NewGuid(), TenantId = Tenant, ItemId = item.Id, BranchId = _cebu, CurrentQuantity = 0m, LastAlertStatus = 3, UpdatedAt = DateTime.UtcNow });
        db.SaveChanges();
    }

    private WTFDbContext AllBranches() =>
        TestDb.Create(_dbName, new FixedTenant(Tenant), new FixedBranch([_makati, _cebu], null, false));

    [Fact]
    public async Task AClosedBranchWithNoStock_IsNotAnOutOfStockRowInTheStockReport()
    {
        await using var db = AllBranches();

        var rows = await new GetStockStatusReportHandler(db).Handle(new GetStockStatusReportQuery(), CancellationToken.None);

        rows.Select(r => r.BranchName).ShouldBe(["Main"]);
        rows.Single().Status.ShouldBe("OK");
    }

    [Fact]
    public async Task AClosedBranchWithNoStock_IsNotOnTheStockAttentionList()
    {
        await using var db = AllBranches();

        var attention = await new GetStockAttentionHandler(db).Handle(new GetStockAttentionQuery(), CancellationToken.None);

        attention.Items.ShouldBeEmpty();
        attention.OutCount.ShouldBe(0);
    }
}
