using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Storage;
using System.Data;
using System.Data.Common;
using System.Reflection;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;

namespace WTF.Domain.Data;

public partial class WTFDbContext
{
    private const string OrderNumberCounter = "OrderNumber";

    private static readonly MethodInfo ApplyTenantFilterMethod = typeof(WTFDbContext)
        .GetMethod(nameof(ApplyTenantFilter), BindingFlags.NonPublic | BindingFlags.Instance)!;

    private readonly ICurrentTenant _currentTenant = NoTenant.Instance;

    public WTFDbContext(DbContextOptions<WTFDbContext> options, ICurrentTenant currentTenant)
        : base(options)
    {
        _currentTenant = currentTenant;
    }

    public bool TenantFilterEnabled => _currentTenant.FilterEnabled;

    private Guid? CurrentTenantId => _currentTenant.TenantId;

    public Guid? StampTenantId => _currentTenant.StampTenantId;

    // Public links, logins and background jobs learn their tenant from data, not from a token.
    public void UseTenant(Guid tenantId)
    {
        if (_currentTenant is ITenantSwitch tenantSwitch)
        {
            tenantSwitch.Use(tenantId);
        }
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        ApplyTenantRules();
        AssignOrderNumbers();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override async Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        ApplyTenantRules();
        await AssignOrderNumbersAsync(cancellationToken);
        return await base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
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

        modelBuilder.Entity<UserRole>().HasQueryFilter(r => !TenantFilterEnabled || r.TenantId == null || r.TenantId == CurrentTenantId);
        modelBuilder.Entity<RolePermission>().HasQueryFilter(p => !TenantFilterEnabled || p.Role.TenantId == null || p.Role.TenantId == CurrentTenantId);
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
        var isUnset = entry.Entity.TenantId == Guid.Empty;

        if (filterEnabled)
        {
            if (stampTenantId is null || (!isUnset && entry.Entity.TenantId != stampTenantId))
            {
                throw new InvalidOperationException("A row cannot be saved without the current tenant, or for another tenant.");
            }

            entry.Entity.TenantId = stampTenantId.Value;
            return;
        }

        if (isUnset && stampTenantId is not null)
        {
            entry.Entity.TenantId = stampTenantId.Value;
        }
    }

    private static void RefuseOtherTenantRow(EntityEntry<ITenantOwned> entry, Guid? stampTenantId)
    {
        var property = entry.Property(nameof(ITenantOwned.TenantId));
        var original = (Guid)property.OriginalValue!;

        if (stampTenantId is null || original != stampTenantId || (Guid)property.CurrentValue! != original)
        {
            throw new InvalidOperationException("A row of another tenant cannot be changed.");
        }
    }

    private List<Order> OrdersNeedingNumber()
    {
        if (!Database.IsRelational())
        {
            return [];
        }

        return ChangeTracker.Entries<Order>()
            .Where(e => e.State == EntityState.Added && e.Entity.OrderNumber == 0)
            .Select(e => e.Entity)
            .ToList();
    }

    private async Task AssignOrderNumbersAsync(CancellationToken cancellationToken)
    {
        var orders = OrdersNeedingNumber();
        if (orders.Count == 0)
        {
            return;
        }

        var tenantId = RequireStampTenant();
        var first = await ReserveOrderNumbersAsync(tenantId, orders.Count, cancellationToken);
        Number(orders, first);
    }

    private void AssignOrderNumbers()
    {
        var orders = OrdersNeedingNumber();
        if (orders.Count == 0)
        {
            return;
        }

        var tenantId = RequireStampTenant();
        var first = ReserveOrderNumbersAsync(tenantId, orders.Count, CancellationToken.None)
            .GetAwaiter().GetResult();
        Number(orders, first);
    }

    private Guid RequireStampTenant()
    {
        if (_currentTenant.StampTenantId is { } stamp)
        {
            return stamp;
        }

        // Without tenant filtering (Single mode, code that has no tenant) the rows belong to the first tenant.
        return _currentTenant.FilterEnabled
            ? throw new InvalidOperationException("An order cannot be numbered without the current tenant.")
            : TenantDefaults.DefaultTenantId;
    }

    private static void Number(List<Order> orders, long first)
    {
        var next = first;
        foreach (var order in orders)
        {
            order.OrderNumber = checked((int)next);
            next++;
        }
    }

    // One atomic statement per call, so two registers never get the same number. It joins the current transaction,
    // so a sale that rolls back also gives its number back.
    private async Task<long> ReserveOrderNumbersAsync(Guid tenantId, int count, CancellationToken cancellationToken)
    {
        var connection = Database.GetDbConnection();
        var wasClosed = connection.State != ConnectionState.Open;
        if (wasClosed)
        {
            await connection.OpenAsync(cancellationToken);
        }

        try
        {
            for (var attempt = 0; attempt < 2; attempt++)
            {
                await using var update = CreateCounterCommand(connection,
                    "UPDATE dbo.TenantCounters SET NextValue = NextValue + @count OUTPUT inserted.NextValue - @count " +
                    "WHERE TenantId = @tenantId AND Name = @name;",
                    tenantId, count);

                var reserved = await update.ExecuteScalarAsync(cancellationToken);
                if (reserved is not null and not DBNull)
                {
                    return Convert.ToInt64(reserved);
                }

                // A new tenant has no counter yet: it starts at 1. A second request may create it first, then the retry reads it.
                await using var insert = CreateCounterCommand(connection,
                    "INSERT INTO dbo.TenantCounters (TenantId, Name, NextValue) " +
                    "SELECT @tenantId, @name, @count + 1 WHERE NOT EXISTS " +
                    "(SELECT 1 FROM dbo.TenantCounters WHERE TenantId = @tenantId AND Name = @name);",
                    tenantId, count);

                if (await insert.ExecuteNonQueryAsync(cancellationToken) > 0)
                {
                    return 1;
                }
            }

            throw new InvalidOperationException("The order number counter could not be read.");
        }
        finally
        {
            if (wasClosed)
            {
                await connection.CloseAsync();
            }
        }
    }

    private DbCommand CreateCounterCommand(DbConnection connection, string sql, Guid tenantId, int count)
    {
        var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Transaction = Database.CurrentTransaction?.GetDbTransaction();
        AddParameter(command, "@tenantId", tenantId);
        AddParameter(command, "@name", OrderNumberCounter);
        AddParameter(command, "@count", (long)count);
        return command;
    }

    private static void AddParameter(DbCommand command, string name, object value)
    {
        var parameter = command.CreateParameter();
        parameter.ParameterName = name;
        parameter.Value = value;
        command.Parameters.Add(parameter);
    }
}
