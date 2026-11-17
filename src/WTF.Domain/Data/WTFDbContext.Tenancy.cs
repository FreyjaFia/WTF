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
    public const string BranchFilterName = "Branch";
    private const string TenantFilterName = "Tenant";

    private static readonly MethodInfo ApplyTenantFilterMethod = typeof(WTFDbContext)
        .GetMethod(nameof(ApplyTenantFilter), BindingFlags.NonPublic | BindingFlags.Instance)!;

    private static readonly MethodInfo ApplyBranchFilterMethod = typeof(WTFDbContext)
        .GetMethod(nameof(ApplyBranchFilter), BindingFlags.NonPublic | BindingFlags.Instance)!;

    private readonly ICurrentTenant _currentTenant = NoTenant.Instance;
    private readonly ICurrentBranch _currentBranch = NoBranch.Instance;

    public WTFDbContext(DbContextOptions<WTFDbContext> options, ICurrentTenant currentTenant)
        : base(options)
    {
        _currentTenant = currentTenant;
    }

    public WTFDbContext(DbContextOptions<WTFDbContext> options, ICurrentTenant currentTenant, ICurrentBranch currentBranch)
        : base(options)
    {
        _currentTenant = currentTenant;
        _currentBranch = currentBranch;
    }

    public bool TenantFilterEnabled => _currentTenant.FilterEnabled;

    private Guid? CurrentTenantId => _currentTenant.TenantId;

    public Guid? StampTenantId => _currentTenant.StampTenantId;

    public bool BranchFilterEnabled => _currentBranch.FilterEnabled;

    public IReadOnlyCollection<Guid> VisibleBranchIds => _currentBranch.VisibleBranchIds;

    public Guid? ActiveBranchId => _currentBranch.ActiveBranchId;

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
        ApplyBranchRules();
        AssignOrderNumbers();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override async Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        ApplyTenantRules();
        ApplyBranchRules();
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

        foreach (var entityType in modelBuilder.Model.GetEntityTypes().ToList())
        {
            if (typeof(IBranchOwned).IsAssignableFrom(entityType.ClrType))
            {
                ApplyBranchFilterMethod.MakeGenericMethod(entityType.ClrType).Invoke(this, [modelBuilder]);
            }
        }

        // A limited user sees only their branches in the branch list; the children of branch-owned rows follow their parent.
        modelBuilder.Entity<Branch>().HasQueryFilter(BranchFilterName, b => !BranchFilterEnabled || VisibleBranchIds.Contains(b.Id));
        modelBuilder.Entity<OrderItem>().HasQueryFilter(BranchFilterName, i => !BranchFilterEnabled || VisibleBranchIds.Contains(i.Order.BranchId));
        modelBuilder.Entity<StockCountLine>().HasQueryFilter(BranchFilterName, l => !BranchFilterEnabled || VisibleBranchIds.Contains(l.Count.BranchId));
        modelBuilder.Entity<StockReceiptLine>().HasQueryFilter(BranchFilterName, l => !BranchFilterEnabled || VisibleBranchIds.Contains(l.Receipt.BranchId));
        modelBuilder.Entity<PurchaseOrderLine>().HasQueryFilter(BranchFilterName, l => !BranchFilterEnabled || VisibleBranchIds.Contains(l.PurchaseOrder.BranchId));

        modelBuilder.Entity<UserRole>().HasQueryFilter(r => !TenantFilterEnabled || r.TenantId == null || r.TenantId == CurrentTenantId);
        modelBuilder.Entity<RolePermission>().HasQueryFilter(p => !TenantFilterEnabled || p.Role.TenantId == null || p.Role.TenantId == CurrentTenantId);

        modelBuilder.Entity<OrderItem>().ToTable(t => t.HasCheckConstraint("CK_OrderItems_Quantity_Range", "[Quantity] >= 1 AND [Quantity] <= 9999"));
    }

    private void ApplyTenantFilter<TEntity>(ModelBuilder modelBuilder)
        where TEntity : class, ITenantOwned
    {
        modelBuilder.Entity<TEntity>().HasQueryFilter(TenantFilterName, e => !TenantFilterEnabled || e.TenantId == CurrentTenantId);
    }

    private void ApplyBranchFilter<TEntity>(ModelBuilder modelBuilder)
        where TEntity : class, IBranchOwned
    {
        modelBuilder.Entity<TEntity>().HasQueryFilter(BranchFilterName, e => !BranchFilterEnabled || VisibleBranchIds.Contains(e.BranchId));
    }

    private void ApplyBranchRules()
    {
        var entries = ChangeTracker.Entries<IBranchOwned>()
            .Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
            .ToList();
        if (entries.Count == 0)
        {
            return;
        }

        var filterEnabled = _currentBranch.WriteCheckEnabled;
        var allowed = _currentBranch.AllowedBranchIds;
        Guid? stamp = null;
        var stampLoaded = false;

        foreach (var entry in entries)
        {
            switch (entry.State)
            {
                case EntityState.Added:
                    if (entry.Entity.BranchId == Guid.Empty)
                    {
                        if (!stampLoaded)
                        {
                            stamp = _currentBranch.ActiveBranchId ?? FindMainBranchId();
                            stampLoaded = true;
                        }

                        if (stamp is { } branchId)
                        {
                            entry.Entity.BranchId = branchId;
                        }
                    }

                    if (filterEnabled && !allowed.Contains(entry.Entity.BranchId))
                    {
                        throw new InvalidOperationException("A row cannot be saved for a branch the user may not use.");
                    }

                    break;

                case EntityState.Modified:
                case EntityState.Deleted:
                    if (filterEnabled)
                    {
                        var property = entry.Property(nameof(IBranchOwned.BranchId));
                        if (!allowed.Contains((Guid)property.OriginalValue!) || (Guid)property.CurrentValue! != (Guid)property.OriginalValue!)
                        {
                            throw new InvalidOperationException("A row of another branch cannot be changed.");
                        }
                    }

                    break;
            }
        }
    }

    // Public links and background jobs have no signed-in branch: their rows go to the shop's Main branch, unless the code named one.
    private Guid? FindMainBranchId()
    {
        var tenantId = _currentTenant.StampTenantId ?? (_currentTenant.FilterEnabled ? null : TenantDefaults.DefaultTenantId);
        if (tenantId is null || !Database.IsRelational())
        {
            return null;
        }

        return Branches.IgnoreQueryFilters()
            .Where(b => b.TenantId == tenantId && b.IsMain)
            .Select(b => (Guid?)b.Id)
            .FirstOrDefault();
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
        foreach (var branchOrders in orders.GroupBy(o => o.BranchId))
        {
            var list = branchOrders.ToList();
            var first = await ReserveOrderNumbersAsync(tenantId, CounterName(branchOrders.Key), list.Count, cancellationToken);
            Number(list, first);
        }
    }

    private void AssignOrderNumbers()
    {
        var orders = OrdersNeedingNumber();
        if (orders.Count == 0)
        {
            return;
        }

        var tenantId = RequireStampTenant();
        foreach (var branchOrders in orders.GroupBy(o => o.BranchId))
        {
            var list = branchOrders.ToList();
            var first = ReserveOrderNumbersAsync(tenantId, CounterName(branchOrders.Key), list.Count, CancellationToken.None)
                .GetAwaiter().GetResult();
            Number(list, first);
        }
    }

    public static string CounterName(Guid branchId)
    {
        return branchId == Guid.Empty ? OrderNumberCounter : $"{OrderNumberCounter}:{branchId:D}";
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
    private async Task<long> ReserveOrderNumbersAsync(Guid tenantId, string counterName, int count, CancellationToken cancellationToken)
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
                    tenantId, counterName, count);

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
                    tenantId, counterName, count);

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

    private DbCommand CreateCounterCommand(DbConnection connection, string sql, Guid tenantId, string counterName, int count)
    {
        var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Transaction = Database.CurrentTransaction?.GetDbTransaction();
        AddParameter(command, "@tenantId", tenantId);
        AddParameter(command, "@name", counterName);
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
