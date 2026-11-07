using Microsoft.EntityFrameworkCore;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Tenancy;

public class TenantClassificationTests
{
    // Tables shared by every tenant (TenantCounter has a TenantId key but is never filtered: it is only read by the order number allocator). A new entity must be added here on purpose, or be tenant-owned.
    private static readonly HashSet<Type> GlobalEntities =
    [
        typeof(PaymentMethod),
        typeof(SchemaScriptHistory),
        typeof(Status),
        typeof(Tenant),
        typeof(TenantCounter),
        typeof(UserRole),
    ];

    [Fact]
    public void EveryEntity_IsEitherTenantOwnedOrListedAsGlobal()
    {
        using var db = TestDb.Create();

        var unclassified = db.Model.GetEntityTypes()
            .Select(e => e.ClrType)
            .Where(t => !typeof(ITenantOwned).IsAssignableFrom(t) && !GlobalEntities.Contains(t))
            .Select(t => t.Name)
            .ToList();

        unclassified.ShouldBeEmpty("Add TenantId (and ITenantOwned) to these entities, or list them as global.");
    }

    [Fact]
    public void EveryTenantOwnedEntity_HasAQueryFilterAndATenantIdColumn()
    {
        using var db = TestDb.Create();

        foreach (var entity in db.Model.GetEntityTypes().Where(e => typeof(ITenantOwned).IsAssignableFrom(e.ClrType)))
        {
            entity.GetDeclaredQueryFilters().ShouldNotBeEmpty($"{entity.ClrType.Name} has no tenant query filter.");
            entity.FindProperty(nameof(ITenantOwned.TenantId)).ShouldNotBeNull(entity.ClrType.Name);
        }
    }

    [Fact]
    public void GlobalEntities_HaveNoTenantId()
    {
        using var db = TestDb.Create();

        foreach (var type in GlobalEntities.Where(t => t != typeof(TenantCounter)))
        {
            db.Model.FindEntityType(type)!.FindProperty("TenantId").ShouldBeNull(type.Name);
        }
    }
}
