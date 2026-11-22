using WTF.Api.Common.Orders;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Branches;

public class BranchPricePlanGateTests
{
    private static readonly Guid Tenant = TenantDefaults.DefaultTenantId;

    private readonly string _dbName = TestDb.NewName();
    private readonly Guid _cebu = Guid.NewGuid();
    private readonly Guid _latte = Guid.NewGuid();

    private async Task SeedAsync(string planFeatures)
    {
        await using var db = TestDb.Create(_dbName);
        db.Branches.Add(new Branch { Id = _cebu, TenantId = Tenant, Name = "Cebu", Code = "CEB", TimeZone = "Asia/Manila", IsActive = true, CreatedAt = DateTime.UtcNow });
        db.ProductBranchPrices.Add(new ProductBranchPrice { Id = Guid.NewGuid(), TenantId = Tenant, ProductId = _latte, BranchId = _cebu, Price = 175m, CreatedAt = DateTime.UtcNow });
        var plan = new Plan { Code = "test", Name = "Test", MonthlyPrice = 1, Features = planFeatures, IsActive = true, SortOrder = 1 };
        db.Plans.Add(plan);
        await db.SaveChangesAsync();
        db.TenantSubscriptions.Add(new TenantSubscription { TenantId = Tenant, PlanId = plan.Id, CurrentPeriodStart = DateTime.UtcNow, CurrentPeriodEnd = DateTime.UtcNow.AddDays(30), GraceDays = 3, UpdatedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
    }

    private WTFDbContext Open() => TestDb.Create(_dbName, new FixedTenant(Tenant));

    [Fact]
    public async Task APlanWithBranches_UsesTheBranchPrice()
    {
        await SeedAsync("branches");
        await using var db = Open();

        var prices = await BranchPriceLookup.ForBranchAsync(db, TestFakes.Features, _cebu, null, CancellationToken.None);

        prices[_latte].ShouldBe(175m);
    }

    [Fact]
    public async Task APlanWithoutBranches_IgnoresTheBranchPrices()
    {
        await SeedAsync("inventory");
        await using var db = Open();

        var prices = await BranchPriceLookup.ForBranchAsync(db, TestFakes.Features, _cebu, null, CancellationToken.None);

        prices.ShouldBeEmpty();
    }
}
