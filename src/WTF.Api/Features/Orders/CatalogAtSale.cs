using WTF.Api.Common.Catalog;
using WTF.Calculations.Catalog;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

internal sealed class CatalogAtSale
{
    private readonly WTFDbContext _db;
    private readonly bool _useLog;
    private readonly Dictionary<Guid, bool> _covered = [];

    private CatalogAtSale(WTFDbContext db, DateTime soldAt, DateTime? deviceSyncedAt, bool useLog)
    {
        _db = db;
        SoldAt = soldAt;
        DeviceSyncedAt = deviceSyncedAt;
        _useLog = useLog;
    }

    public DateTime SoldAt { get; }

    public DateTime? DeviceSyncedAt { get; }

    public static CatalogAtSale Create(WTFDbContext db, DateTime soldAt, DateTime? deviceSyncedAt)
    {
        var useLog = deviceSyncedAt.HasValue && deviceSyncedAt.Value <= soldAt && db.StampTenantId.HasValue;
        return new CatalogAtSale(db, soldAt, deviceSyncedAt, useLog);
    }

    public async Task<decimal> ProductPriceAsync(Guid productId, decimal currentPrice, CancellationToken cancellationToken)
    {
        if (!await CoversAsync(CatalogEntityTypes.Product, productId, cancellationToken))
        {
            return currentPrice;
        }

        var asOf = await CatalogHistory.DecimalAsOfAsync(
            _db, CatalogEntityTypes.Product, productId, "Price", currentPrice, SoldAt, cancellationToken);
        return asOf ?? currentPrice;
    }

    public async Task<bool> ProductIsActiveAsync(Guid productId, bool currentlyActive, CancellationToken cancellationToken)
    {
        if (!await CoversAsync(CatalogEntityTypes.Product, productId, cancellationToken))
        {
            return currentlyActive;
        }

        var asOf = await CatalogHistory.BoolAsOfAsync(
            _db, CatalogEntityTypes.Product, productId, "IsActive", currentlyActive, SoldAt, cancellationToken);
        return asOf ?? currentlyActive;
    }

    public async Task<decimal?> AddOnOverrideAsync(
        Guid parentId,
        Guid addOnId,
        decimal? currentOverride,
        CancellationToken cancellationToken)
    {
        var key = CatalogHistoryRules.AddOnOverrideKey(parentId, addOnId);
        if (!await CoversAsync(CatalogEntityTypes.AddOnPriceOverride, key, cancellationToken))
        {
            return currentOverride;
        }

        var price = await CatalogHistory.DecimalAsOfAsync(
            _db, CatalogEntityTypes.AddOnPriceOverride, key, "Price", currentOverride, SoldAt, cancellationToken);
        var active = await CatalogHistory.BoolAsOfAsync(
            _db, CatalogEntityTypes.AddOnPriceOverride, key, "IsActive", true, SoldAt, cancellationToken);
        return active == false ? null : price;
    }

    public async Task<(bool SeniorPwdEnabled, bool VatRegistered)> ShopSettingsAsync(
        Guid tenantId,
        bool seniorPwdEnabled,
        bool vatRegistered,
        CancellationToken cancellationToken)
    {
        if (!await CoversAsync(CatalogEntityTypes.TenantSettings, tenantId, cancellationToken))
        {
            return (seniorPwdEnabled, vatRegistered);
        }

        var enabled = await CatalogHistory.BoolAsOfAsync(
            _db, CatalogEntityTypes.TenantSettings, tenantId, "SeniorPwdEnabled", seniorPwdEnabled, SoldAt, cancellationToken);
        var vat = await CatalogHistory.BoolAsOfAsync(
            _db, CatalogEntityTypes.TenantSettings, tenantId, "VatRegistered", vatRegistered, SoldAt, cancellationToken);
        return (enabled ?? seniorPwdEnabled, vat ?? vatRegistered);
    }

    private async Task<bool> CoversAsync(string entityType, Guid entityId, CancellationToken cancellationToken)
    {
        if (!_useLog)
        {
            return false;
        }

        if (!_covered.TryGetValue(entityId, out var covered))
        {
            covered = await CatalogHistory.HasHistorySinceAsync(
                _db, _db.StampTenantId!.Value, entityType, entityId, DeviceSyncedAt!.Value, cancellationToken);
            _covered[entityId] = covered;
        }

        return covered;
    }
}
