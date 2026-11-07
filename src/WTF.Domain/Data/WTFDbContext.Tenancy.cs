using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using System.Reflection;
using WTF.Domain.Tenancy;

namespace WTF.Domain.Data;

public partial class WTFDbContext
{
    private static readonly MethodInfo ApplyTenantFilterMethod = typeof(WTFDbContext)
        .GetMethod(nameof(ApplyTenantFilter), BindingFlags.NonPublic | BindingFlags.Instance)!;

    private readonly ICurrentTenant _currentTenant = NoTenant.Instance;

    public WTFDbContext(DbContextOptions<WTFDbContext> options, ICurrentTenant currentTenant)
        : base(options)
    {
        _currentTenant = currentTenant;
    }

    private bool TenantFilterEnabled => _currentTenant.FilterEnabled;

    private Guid? CurrentTenantId => _currentTenant.TenantId;

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        ApplyTenantRules();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        ApplyTenantRules();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    partial void OnModelCreatingPartial(ModelBuilder modelBuilder)
    {
        foreach (var entityType in modelBuilder.Model.GetEntityTypes().ToList())
        {
            if (typeof(ITenantOwned).IsAssignableFrom(entityType.ClrType))
            {
                ApplyTenantFilterMethod.MakeGenericMethod(entityType.ClrType).Invoke(this, [modelBuilder]);
            }
        }
    }

    private void ApplyTenantFilter<TEntity>(ModelBuilder modelBuilder)
        where TEntity : class, ITenantOwned
    {
        modelBuilder.Entity<TEntity>().HasQueryFilter(e => !TenantFilterEnabled || e.TenantId == CurrentTenantId);
    }

    private void ApplyTenantRules()
    {
        var stampTenantId = _currentTenant.StampTenantId;
        var filterEnabled = _currentTenant.FilterEnabled;

        foreach (var entry in ChangeTracker.Entries<ITenantOwned>())
        {
            switch (entry.State)
            {
                case EntityState.Added:
                    StampNewRow(entry, stampTenantId, filterEnabled);
                    break;

                case EntityState.Modified:
                case EntityState.Deleted:
                    if (filterEnabled)
                    {
                        RefuseOtherTenantRow(entry, stampTenantId);
                    }

                    break;
            }
        }
    }

    private static void StampNewRow(EntityEntry<ITenantOwned> entry, Guid? stampTenantId, bool filterEnabled)
    {
        if (filterEnabled)
        {
            if (stampTenantId is null || (entry.Entity.TenantId is not null && entry.Entity.TenantId != stampTenantId))
            {
                throw new InvalidOperationException("A row cannot be saved without the current tenant, or for another tenant.");
            }

            entry.Entity.TenantId = stampTenantId;
            return;
        }

        if (entry.Entity.TenantId is null && stampTenantId is not null)
        {
            entry.Entity.TenantId = stampTenantId;
        }
    }

    private static void RefuseOtherTenantRow(EntityEntry<ITenantOwned> entry, Guid? stampTenantId)
    {
        var property = entry.Property(nameof(ITenantOwned.TenantId));
        var original = (Guid?)property.OriginalValue;

        if (stampTenantId is null || original != stampTenantId || (Guid?)property.CurrentValue != original)
        {
            throw new InvalidOperationException("A row of another tenant cannot be changed.");
        }
    }
}
