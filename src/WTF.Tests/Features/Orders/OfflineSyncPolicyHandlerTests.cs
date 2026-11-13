using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Services;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Orders;

public class OfflineSyncPolicyHandlerTests
{
    private static readonly Guid TenantA = TenantDefaults.DefaultTenantId;
    private static readonly Guid TenantB = Guid.Parse("00000000-0000-0000-0000-0000000000b2");

    private readonly string _dbName = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();
    private readonly IAuditService _audit = TestFakes.Audit();

    private static UpdateOfflineSyncPolicyCommand Update(
        decimal tolerance = 0m,
        bool autoApprove = false,
        int days = 2,
        params (string Code, string Mode)[] modes) =>
        new([.. modes.Select(m => new OfflineSyncCodeModeDto(m.Code, m.Mode))], tolerance, autoApprove, days);

    [Fact]
    public async Task Get_WithNoRow_ReturnsTheDefaults()
    {
        var policy = await GetAsync(TenantA);

        policy.PriceTolerance.ShouldBe(0m);
        policy.AutoApproveNotes.ShouldBeFalse();
        policy.AgedAfterDays.ShouldBe(2);
        policy.UpdatedAt.ShouldBeNull();
        policy.Codes.Select(c => c.Code).ShouldBe(
            ["PriceChanged", "AddOnPriceChanged", "ProductInactive", "BundleChanged", "CustomerInactive", "PromotionEnded", "UnknownProduct"]);
        policy.Codes.ShouldAllBe(c => c.Mode == "Hold");
    }

    [Fact]
    public async Task Update_SavesTheChosenModesToleranceAutoApproveAndDays()
    {
        var saved = await UpdateAsync(TenantA, Update(5m, true, 7, ("CustomerInactive", "Note"), ("PriceChanged", "Hold")));

        saved.PriceTolerance.ShouldBe(5m);
        saved.AutoApproveNotes.ShouldBeTrue();
        saved.AgedAfterDays.ShouldBe(7);
        saved.Codes.Single(c => c.Code == "CustomerInactive").Mode.ShouldBe("Note");
        saved.Codes.Single(c => c.Code == "ProductInactive").Mode.ShouldBe("Hold");

        var again = await GetAsync(TenantA);
        again.Codes.Select(c => (c.Code, c.Mode)).ShouldBe(saved.Codes.Select(c => (c.Code, c.Mode)));
        again.PriceTolerance.ShouldBe(5m);
        again.AutoApproveNotes.ShouldBeTrue();
        again.AgedAfterDays.ShouldBe(7);
        again.UpdatedAt.ShouldNotBeNull();
    }

    [Fact]
    public async Task Update_IsAuditedWithTheBeforeAndAfter()
    {
        await UpdateAsync(TenantA, Update(5m, false, 2, ("UnknownProduct", "Note")));

        await _audit.Received(1).LogAsync(
            AuditAction.OfflineSyncPolicyChanged,
            AuditEntityType.OfflineSyncPolicy,
            TenantA.ToString(),
            Arg.Is<object?>(o => ((OfflineSyncPolicyDto)o!).PriceTolerance == 0m),
            Arg.Is<object?>(o => ((OfflineSyncPolicyDto)o!).PriceTolerance == 5m),
            _userId,
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Update_LeavesCodesNotListedAsTheyWere()
    {
        await UpdateAsync(TenantA, Update(0m, false, 2, ("CustomerInactive", "Note")));
        var saved = await UpdateAsync(TenantA, Update(0m, false, 2, ("BundleChanged", "Note")));

        saved.Codes.Where(c => c.Mode == "Note").Select(c => c.Code).ShouldBe(["BundleChanged", "CustomerInactive"], ignoreOrder: true);
    }

    [Theory]
    [InlineData(-0.01)]
    [InlineData(1000.01)]
    [InlineData(2.005)]
    public async Task Update_RefusesAToleranceOutsideZeroToAThousandPesos(double tolerance)
    {
        await Should.ThrowAsync<InvalidOperationException>(() => UpdateAsync(TenantA, Update((decimal)tolerance)));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(31)]
    public async Task Update_RefusesDaysOutsideOneToThirty(int days)
    {
        await Should.ThrowAsync<InvalidOperationException>(() => UpdateAsync(TenantA, Update(0m, false, days)));
    }

    [Theory]
    [InlineData("SeniorPwdDisabled", "Note")]
    [InlineData("SeniorPwdIdMissing", "Note")]
    [InlineData("PromotionOverLimit", "Hold")]
    [InlineData("StockShortfall", "Hold")]
    [InlineData("Nonsense", "Hold")]
    [InlineData("PriceChanged", "Maybe")]
    public async Task Update_RefusesACodeItCannotChangeAndAnUnknownMode(string code, string mode)
    {
        await Should.ThrowAsync<InvalidOperationException>(() => UpdateAsync(TenantA, Update(0m, false, 2, (code, mode))));
    }

    [Fact]
    public async Task Update_RefusesTheSameCodeTwice()
    {
        await Should.ThrowAsync<InvalidOperationException>(
            () => UpdateAsync(TenantA, Update(0m, false, 2, ("PriceChanged", "Note"), ("PriceChanged", "Hold"))));
    }

    [Fact]
    public async Task APolicyBelongsToOneShop()
    {
        await UpdateAsync(TenantA, Update(50m, true, 9, ("PriceChanged", "Note")));

        var other = await GetAsync(TenantB);
        other.PriceTolerance.ShouldBe(0m);
        other.AutoApproveNotes.ShouldBeFalse();
        other.Codes.ShouldAllBe(c => c.Mode == "Hold");

        await UpdateAsync(TenantB, Update(1m, false, 3));
        (await GetAsync(TenantA)).PriceTolerance.ShouldBe(50m);
        (await GetAsync(TenantB)).PriceTolerance.ShouldBe(1m);
    }

    private async Task<OfflineSyncPolicyDto> GetAsync(Guid tenantId)
    {
        await using var db = TestDb.Create(_dbName, new FixedTenant(tenantId));
        return await new GetOfflineSyncPolicyHandler(db).Handle(new GetOfflineSyncPolicyQuery(), CancellationToken.None);
    }

    private async Task<OfflineSyncPolicyDto> UpdateAsync(Guid tenantId, UpdateOfflineSyncPolicyCommand command)
    {
        await using var db = TestDb.Create(_dbName, new FixedTenant(tenantId));
        var handler = new UpdateOfflineSyncPolicyHandler(db, TestRequest.As(_userId, AppRoles.Owner), _audit);
        return await handler.Handle(command, CancellationToken.None);
    }

    private sealed class FixedTenant(Guid id) : ICurrentTenant
    {
        public bool FilterEnabled => true;

        public Guid? TenantId => id;

        public Guid? StampTenantId => id;
    }
}
