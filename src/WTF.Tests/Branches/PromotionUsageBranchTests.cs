using WTF.Api.Common.Orders;
using WTF.Calculations.Sales;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Branches;

public class PromotionUsageBranchTests
{
    private static readonly Guid Tenant = TenantDefaults.DefaultTenantId;

    private readonly string _dbName = TestDb.NewName();
    private readonly Guid _makati;
    private readonly Guid _cebu = Guid.NewGuid();
    private readonly Guid _promotion = Guid.NewGuid();

    public PromotionUsageBranchTests()
    {
        using var db = TestDb.Create(_dbName);
        _makati = db.Branches.Single(b => b.IsMain).Id;
        db.Branches.Add(new Branch { Id = _cebu, TenantId = Tenant, Name = "Cebu", Code = "CEB", TimeZone = "Asia/Manila", IsActive = true, CreatedAt = DateTime.UtcNow });
        AddOrder(db, _makati, OrderStatuses.Completed, discountedQuantity: 3, bundleQuantity: 1);
        AddOrder(db, _cebu, OrderStatuses.Completed, discountedQuantity: 4, bundleQuantity: 2);
        AddOrder(db, _cebu, OrderStatuses.Cancelled, discountedQuantity: 9, bundleQuantity: 9);
        db.SaveChanges();
    }

    private void AddOrder(WTF.Domain.Data.WTFDbContext db, Guid branchId, int statusId, int discountedQuantity, int bundleQuantity)
    {
        var order = new Order
        {
            Id = Guid.NewGuid(),
            TenantId = Tenant,
            BranchId = branchId,
            StatusId = statusId,
            CreatedBy = Guid.NewGuid(),
            CreatedAt = DateTime.UtcNow
        };
        db.Orders.Add(order);
        db.OrderItems.Add(new OrderItem
        {
            Id = Guid.NewGuid(),
            TenantId = Tenant,
            OrderId = order.Id,
            ProductId = Guid.NewGuid(),
            Quantity = discountedQuantity,
            DiscountPromotionId = _promotion
        });
        db.OrderBundlePromotions.Add(new OrderBundlePromotion
        {
            Id = Guid.NewGuid(),
            TenantId = Tenant,
            OrderId = order.Id,
            PromotionId = _promotion,
            Quantity = bundleQuantity,
            UnitPrice = 100m
        });
    }

    [Fact]
    public async Task APromotionLimit_CountsEveryBranch_WhicheverBranchThePersonWorksIn()
    {
        foreach (var (visible, active) in new[] { (new[] { _cebu }, _cebu), (new[] { _makati }, _makati), (new[] { _makati, _cebu }, _makati) })
        {
            await using var db = TestDb.Create(_dbName, new FixedTenant(Tenant), new FixedBranch(visible, active, visible.Length == 1));

            var used = await PromotionUsage.CountAsync(db, [_promotion], null, CancellationToken.None);

            used[_promotion].ShouldBe(3 + 1 + 4 + 2);
        }
    }
}
