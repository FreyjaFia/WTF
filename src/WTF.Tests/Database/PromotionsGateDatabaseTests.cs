using WTF.Api.Common.Orders;
using WTF.Calculations.Subscriptions;
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
}
