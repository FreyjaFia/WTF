using WTF.Api.Common.Tenancy;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Tenancy;

public class TenantFeatureCacheTests
{
    private static readonly Guid ShopA = Guid.NewGuid();
    private static readonly Guid ShopB = Guid.NewGuid();

    private sealed class MovableClock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 11, 15, 8, 0, 0, TimeSpan.Zero);

        public override DateTimeOffset GetUtcNow() => Now;
    }

    private static async Task<(string Db, Plan Plan)> SeedAsync()
    {
        var name = TestDb.NewName();
        var plan = new Plan { Code = "p", Name = "Plan", MonthlyPrice = 1, Features = "inventory", IsActive = true, SortOrder = 1 };
        await TestDb.SaveAsync(name, plan);
        foreach (var shop in new[] { ShopA, ShopB })
        {
            await TestDb.SaveAsync(
                name,
                new TenantSubscription
                {
                    TenantId = shop,
                    PlanId = plan.Id,
                    CurrentPeriodStart = DateTime.UtcNow,
                    CurrentPeriodEnd = DateTime.UtcNow.AddDays(30),
                    GraceDays = 0,
                    UpdatedAt = DateTime.UtcNow,
                });
        }

        return (name, plan);
    }

    private static async Task SetFeaturesAsync(string dbName, int planId, string features)
    {
        await using var db = TestDb.Create(dbName);
        (await db.Plans.FindAsync(planId))!.Features = features;
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task ForgettingOneShop_KeepsTheOthersCached()
    {
        var (name, plan) = await SeedAsync();
        var cache = new TenantFeatureCache(new MovableClock());
        await using var db = TestDb.Create(name);
        await cache.GetAsync(db, ShopA, CancellationToken.None);
        await cache.GetAsync(db, ShopB, CancellationToken.None);

        await SetFeaturesAsync(name, plan.Id, "promotions");
        cache.Forget(ShopA);

        (await cache.GetAsync(db, ShopA, CancellationToken.None)).Features.ShouldContain("promotions");
        (await cache.GetAsync(db, ShopB, CancellationToken.None)).Features.ShouldContain("inventory");
        (await cache.GetAsync(db, ShopB, CancellationToken.None)).Features.ShouldNotContain("promotions");
    }

    [Fact]
    public async Task ForgetAll_ClearsEveryShop()
    {
        var (name, plan) = await SeedAsync();
        var cache = new TenantFeatureCache(new MovableClock());
        await using var db = TestDb.Create(name);
        await cache.GetAsync(db, ShopA, CancellationToken.None);

        await SetFeaturesAsync(name, plan.Id, "promotions");
        cache.Forget();

        (await cache.GetAsync(db, ShopA, CancellationToken.None)).Features.ShouldContain("promotions");
    }

    [Fact]
    public async Task AnEntryExpiresAfterItsLifetime()
    {
        var (name, plan) = await SeedAsync();
        var clock = new MovableClock();
        var cache = new TenantFeatureCache(clock);
        await using var db = TestDb.Create(name);
        await cache.GetAsync(db, ShopA, CancellationToken.None);

        await SetFeaturesAsync(name, plan.Id, "promotions");
        (await cache.GetAsync(db, ShopA, CancellationToken.None)).Features.ShouldNotContain("promotions");

        clock.Now += TenantFeatureCache.Lifetime + TimeSpan.FromSeconds(1);

        (await cache.GetAsync(db, ShopA, CancellationToken.None)).Features.ShouldContain("promotions");
    }
}
