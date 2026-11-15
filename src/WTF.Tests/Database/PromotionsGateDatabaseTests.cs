using WTF.Api.Common.Orders;
using WTF.Api.Common.Tenancy;
using WTF.Calculations.Subscriptions;
using WTF.Domain.Data;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

public class PromotionsGateDatabaseTests
{
    private static readonly FixedTenant Shop = new(TenantDefaults.DefaultTenantId);

    [SqlFact]
    public async Task TheGate_ReadsTheCachedPlan_AndNeverTheDatabase_WhenGivenOne()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await using var db = database.CreateContext(Shop);
        var counting = new CountingFeatures(PlanFeatures.Parse("reports"));

        (await PromotionsGate.IsOnAsync(db, counting, CancellationToken.None)).ShouldBeFalse();
        (await DiscountRuleLoader.LoadAsync(db, DateTime.UtcNow, TimeZoneInfo.Utc, null, CancellationToken.None, counting)).RulesByProductId.ShouldBeEmpty();

        counting.Calls.ShouldBe(2);
    }

    [SqlFact]
    public async Task TheGate_IsOpen_WhenTheCachedPlanHoldsPromotions()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await using var db = database.CreateContext(Shop);

        (await PromotionsGate.IsOnAsync(db, new CountingFeatures(PlanFeatures.Parse("promotions")), CancellationToken.None)).ShouldBeTrue();
    }

    private sealed class CountingFeatures(IReadOnlySet<string> features) : ITenantFeatures
    {
        public int Calls { get; private set; }

        public Task<TenantPlan> GetAsync(WTFDbContext db, Guid tenantId, CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult(new TenantPlan("Test", features));
        }

        public void Forget()
        {
        }

        public void Forget(Guid tenantId)
        {
        }
    }
}
