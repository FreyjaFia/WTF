using WTF.Api.Common.Auth;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Branches;

public class SeniorPwdIdCheckBranchTests
{
    private static readonly Guid Tenant = TenantDefaults.DefaultTenantId;

    private readonly string _dbName = TestDb.NewName();
    private readonly Guid _makati;
    private readonly Guid _cebu = Guid.NewGuid();

    public SeniorPwdIdCheckBranchTests()
    {
        using var db = TestDb.Create(_dbName);
        _makati = db.Branches.Single(b => b.IsMain).Id;
        db.Branches.Add(new Branch { Id = _cebu, TenantId = Tenant, Name = "Cebu", Code = "CEB", TimeZone = "Asia/Manila", IsActive = true, CreatedAt = DateTime.UtcNow });
        db.SaveChanges();
    }

    [Fact]
    public async Task SeniorPwdIdCheck_AnIdUsedTodayAtAnotherBranch_IsUsed()
    {
        var userId = Guid.NewGuid();
        var orderId = Guid.NewGuid();
        await using (var db = TestDb.Create(_dbName))
        {
            db.Orders.Add(new Order
            {
                Id = orderId,
                TenantId = Tenant,
                BranchId = _cebu,
                OrderNumber = 42,
                StatusId = (int)OrderStatusEnum.Completed,
                CreatedBy = userId,
                CreatedAt = DateTime.UtcNow
            });
            db.OrderSeniorPwdDiscounts.Add(new OrderSeniorPwdDiscount
            {
                Id = Guid.NewGuid(),
                TenantId = Tenant,
                BranchId = _cebu,
                OrderId = orderId,
                Type = (byte)SeniorPwdTypeEnum.Senior,
                IdNumber = "SC-123456",
                CustomerName = "Lola Remedios",
                RecordedBy = userId,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        await using var scoped = TestDb.Create(_dbName, new FixedTenant(Tenant), new FixedBranch([_makati], _makati, true));
        var handler = new SeniorPwdIdCheckHandler(scoped, TestRequest.As(userId, AppRoles.Cashier));

        var check = await handler.Handle(new SeniorPwdIdCheckQuery("sc 123456"), CancellationToken.None);

        check.UsedToday.ShouldBeTrue();
        check.LastOrderNumber.ShouldBe(42);
    }
}
