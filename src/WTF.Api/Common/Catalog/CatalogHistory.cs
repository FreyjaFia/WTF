using Microsoft.EntityFrameworkCore;
using WTF.Calculations.Catalog;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Common.Catalog;

internal static class CatalogHistory
{
    public static async Task<string?> ValueAsOfAsync(
        WTFDbContext db,
        string entityType,
        Guid entityId,
        string field,
        string? currentValue,
        DateTime asOf,
        CancellationToken cancellationToken)
    {
        var later = await db.CatalogChangeLogs
            .AsNoTracking()
            .Where(l => l.EntityType == entityType && l.EntityId == entityId && l.Field == field && l.EffectiveFrom > asOf)
            .Select(l => new { l.EffectiveFrom, l.CreatedAt, l.OldValue, l.NewValue })
            .ToListAsync(cancellationToken);

        return CatalogHistoryRules.ValueAsOf(
            currentValue,
            later.Select(l => new CatalogFieldChange(l.EffectiveFrom, l.CreatedAt, l.OldValue, l.NewValue)),
            asOf);
    }

    public static async Task<decimal?> DecimalAsOfAsync(
        WTFDbContext db,
        string entityType,
        Guid entityId,
        string field,
        decimal? currentValue,
        DateTime asOf,
        CancellationToken cancellationToken)
    {
        var text = await ValueAsOfAsync(db, entityType, entityId, field, CatalogHistoryRules.Format(currentValue), asOf, cancellationToken);
        return CatalogHistoryRules.ParseDecimal(text);
    }

    public static async Task<bool?> BoolAsOfAsync(
        WTFDbContext db,
        string entityType,
        Guid entityId,
        string field,
        bool? currentValue,
        DateTime asOf,
        CancellationToken cancellationToken)
    {
        var text = await ValueAsOfAsync(db, entityType, entityId, field, CatalogHistoryRules.Format(currentValue), asOf, cancellationToken);
        return CatalogHistoryRules.ParseBool(text);
    }

    public static async Task<List<CatalogChangeLog>> ChangesBetweenAsync(
        WTFDbContext db,
        string entityType,
        Guid entityId,
        DateTime after,
        DateTime before,
        CancellationToken cancellationToken,
        string? field = null)
    {
        var rows = await db.CatalogChangeLogs
            .AsNoTracking()
            .Where(l => l.EntityType == entityType && l.EntityId == entityId && l.EffectiveFrom > after && l.EffectiveFrom <= before)
            .Where(l => field == null || l.Field == field)
            .OrderBy(l => l.CreatedAt)
            .ToListAsync(cancellationToken);

        return CatalogHistoryRules.Between(rows, l => l.EffectiveFrom, after, before);
    }

    public static async Task<bool> HasHistorySinceAsync(
        WTFDbContext db,
        Guid tenantId,
        string entityType,
        Guid entityId,
        DateTime since,
        CancellationToken cancellationToken)
    {
        var hasCreatedRow = await db.CatalogChangeLogs
            .AnyAsync(l => l.EntityType == entityType && l.EntityId == entityId && l.Field == CatalogHistoryRules.CreatedField, cancellationToken);

        DateTime? baselineFrom = await db.CatalogChangeLogs
            .Where(l => l.EntityType == CatalogEntityTypes.Baseline && l.EntityId == tenantId)
            .Select(l => (DateTime?)l.EffectiveFrom)
            .OrderBy(d => d)
            .FirstOrDefaultAsync(cancellationToken);

        return CatalogHistoryRules.CoversSince(hasCreatedRow, baselineFrom, since);
    }
}
