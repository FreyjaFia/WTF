using WTF.Api.Features.Subscriptions;
using WTF.Calculations.Subscriptions;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Subscriptions;

public class PlanChangePreviewTests
{
    private static readonly Guid Shop = Guid.NewGuid();
    private static readonly Guid Other = Guid.NewGuid();

    private readonly string _db = TestDb.NewName();

    private async Task<int> SeedShopOnAsync(string features)
    {
        var current = new Plan { Code = "now", Name = "Now", MonthlyPrice = 1, Features = features, IsActive = true, SortOrder = 1 };
        var starter = new Plan { Code = "starter", Name = "Starter", MonthlyPrice = 0, Features = string.Empty, IsActive = true, SortOrder = 0 };
        await TestDb.SaveAsync(_db, current, starter);
        await TestDb.SaveAsync(
            _db,
            new TenantSubscription
            {
                TenantId = Shop,
                PlanId = current.Id,
                CurrentPeriodStart = DateTime.UtcNow,
                CurrentPeriodEnd = DateTime.UtcNow.AddDays(30),
                GraceDays = 0,
                UpdatedAt = DateTime.UtcNow,
            });
        return starter.Id;
    }

    private async Task<PlanChangePreviewDto> PreviewAsync(int toPlanId)
    {
        await using var db = TestDb.Create(_db);
        return await new GetPlanChangePreviewHandler(db, TimeProvider.System)
            .Handle(new GetPlanChangePreviewQuery(Shop, toPlanId), CancellationToken.None);
    }

    [Fact]
    public async Task EveryFeatureTheShopLoses_ListsHowMuchDataItHolds_AndIgnoresOtherShops()
    {
        var starterId = await SeedShopOnAsync(string.Join(",", PlanFeatures.Gateable));
        var user = Guid.NewGuid();
        var supplier = new Supplier { Id = Guid.NewGuid(), Name = "Beans Co", IsActive = true, CreatedAt = DateTime.UtcNow, CreatedBy = user, TenantId = Shop };
        await TestDb.SaveAsync(
            _db,
            supplier,
            new Supplier { Id = Guid.NewGuid(), Name = "Elsewhere", IsActive = true, CreatedAt = DateTime.UtcNow, CreatedBy = user, TenantId = Other },
            new PurchaseOrder { Id = Guid.NewGuid(), TenantId = Shop, PoNumber = 1, SupplierId = supplier.Id, Status = 1, CreatedAt = DateTime.UtcNow, CreatedBy = user },
            new Expense { Id = Guid.NewGuid(), Amount = 5m, IsActive = true, CreatedAt = DateTime.UtcNow, CreatedBy = user, TenantId = Shop },
            new Expense { Id = Guid.NewGuid(), Amount = 5m, IsActive = false, CreatedAt = DateTime.UtcNow, CreatedBy = user, TenantId = Shop },
            new Conversation { Id = Guid.NewGuid(), CustomerId = Guid.NewGuid(), Title = "Order 1", CreatedAt = DateTime.UtcNow, LastMessageAt = DateTime.UtcNow, TenantId = Shop },
            new UserRole { Id = 101, Name = "Barista", TenantId = Shop, IsSystem = false },
            new UserRole { Id = 102, Name = "Owner", TenantId = Shop, IsSystem = true },
            new AuditLog { Id = Guid.NewGuid(), UserId = user, Action = "UserLogin", EntityType = "User", EntityId = "x", Timestamp = DateTime.UtcNow, TenantId = Shop });

        var preview = await PreviewAsync(starterId);

        LostFeatureDto Lost(string key) => preview.LostFeatures.Single(f => f.Key == key);
        Lost(PlanFeatures.Purchasing).DataCount.ShouldBe(2);
        Lost(PlanFeatures.Expenses).DataCount.ShouldBe(1);
        Lost(PlanFeatures.Chat).DataCount.ShouldBe(1);
        Lost(PlanFeatures.CustomRoles).DataCount.ShouldBe(1);
        Lost(PlanFeatures.Audit).DataCount.ShouldBe(1);
        Lost(PlanFeatures.Workbook).DataCount.ShouldBeNull();
    }

    [Fact]
    public async Task AFeatureWithNoData_StillListsAsLost_WithNoCount()
    {
        var starterId = await SeedShopOnAsync(PlanFeatures.Expenses);

        var preview = await PreviewAsync(starterId);

        var lost = preview.LostFeatures.ShouldHaveSingleItem();
        lost.Key.ShouldBe(PlanFeatures.Expenses);
        lost.DataCount.ShouldBeNull();
    }
}
