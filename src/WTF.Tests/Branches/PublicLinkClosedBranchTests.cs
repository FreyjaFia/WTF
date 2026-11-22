using WTF.Api.Common.Tenancy;
using WTF.Api.Features.OrderLinks;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Branches;

public class PublicLinkClosedBranchTests
{
    private static readonly Guid Tenant = TenantDefaults.DefaultTenantId;

    private readonly string _dbName = TestDb.NewName();
    private readonly Guid _staffId = Guid.NewGuid();
    private readonly Guid _makati;
    private readonly Guid _closed = Guid.NewGuid();
    private readonly Guid _customerId = Guid.NewGuid();

    public PublicLinkClosedBranchTests()
    {
        using var db = TestDb.Create(_dbName);
        _makati = db.Branches.Single(b => b.IsMain).Id;
        db.Branches.Add(new Branch { Id = _closed, TenantId = Tenant, Name = "Old Cebu", Code = "OLD", TimeZone = "Asia/Manila", IsActive = false, CreatedAt = DateTime.UtcNow });
        db.Customers.Add(new Customer { Id = _customerId, FirstName = "Ana", LastName = "Cruz", Address = "12 Mabini St", IsActive = true, AllowOrderingLink = true, CreatedAt = DateTime.UtcNow, CreatedBy = _staffId });
        db.SaveChanges();
    }

    private async Task<ShortLink> AddLinkAsync(Guid branchId)
    {
        var link = new ShortLink
        {
            Id = Guid.NewGuid(),
            Token = OrderLinkToken.Generate(),
            TargetType = OrderLinkToken.TargetType,
            TargetId = _customerId,
            BranchId = branchId,
            CreatedAt = DateTime.UtcNow.AddHours(-1),
            CreatedBy = _staffId,
        };
        await TestDb.SaveAsync(_dbName, link);
        return link;
    }

    [Fact]
    public async Task ALinkOfAnOpenBranch_Resolves()
    {
        var link = await AddLinkAsync(_makati);
        await using var db = TestDb.Create(_dbName);

        var access = await OrderLinkAccess.ResolveAsync(db, link.Token, CancellationToken.None, TestFakes.Features);

        access.ShouldNotBeNull();
        (await OrderLinkAccess.IsStillValidAsync(db, link.Id, DateTime.UtcNow, CancellationToken.None)).ShouldBeTrue();
    }

    [Fact]
    public async Task ALinkOfAClosedBranch_TakesNoOrders()
    {
        var link = await AddLinkAsync(_closed);
        await using var db = TestDb.Create(_dbName);

        await Should.ThrowAsync<ShopUnavailableException>(() =>
            OrderLinkAccess.ResolveAsync(db, link.Token, CancellationToken.None, TestFakes.Features));
        (await OrderLinkAccess.IsStillValidAsync(db, link.Id, DateTime.UtcNow, CancellationToken.None)).ShouldBeFalse();
    }
}
