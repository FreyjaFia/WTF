using Microsoft.EntityFrameworkCore;
using System.Text.RegularExpressions;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

public class SqlScriptTests
{
    private const string SeniorPwdAudit = "20261201_audit_senior_pwd_role_grants.sql";
    private const string PlanCatalogRepair = "20261202_repair_plan_catalog_role_copy.sql";
    private const string QuantityCheck = "20261203_add_order_item_quantity_check.sql";

    private static readonly Guid TenantId = TenantDefaults.DefaultTenantId;
    private static int _nextRoleId = 1000;

    [SqlFact]
    public async Task SeniorPwdAudit_ListsRolesWithoutOverride_ChangesNoPermission_AndRunsOnce()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var withOverride = await AddRoleAsync(database, "Lead", "orders.write", "orders.seniorpwd.apply", "orders.override");
        var without = await AddRoleAsync(database, "Cashier2", "orders.write", "orders.seniorpwd.apply");
        var plain = await AddRoleAsync(database, "Viewer", "orders.read");

        await RunAsync(database, SeniorPwdAudit);
        await RunAsync(database, SeniorPwdAudit);

        await using var db = database.CreateContext();
        var reviews = await db.PlatformAuditLogs.Where(a => a.Action == "SeniorPwdRoleGrantReview").ToListAsync();
        reviews.Count(a => a.TenantId == TenantId).ShouldBe(1);
        reviews.Single(a => a.TenantId == TenantId).Details!.ShouldContain("Cashier2");
        reviews.Count.ShouldBe(2);
        (await Keys(db, without)).ShouldBe(["orders.seniorpwd.apply", "orders.write"]);
        (await Keys(db, withOverride)).Count.ShouldBe(3);
        (await Keys(db, plain)).ShouldBe(["orders.read"]);
    }

    [SqlFact]
    public async Task PlanCatalogRepair_WhenNeitherHalfRan_CopiesAndWritesMarker()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var role = await AddRoleAsync(database, "Stocker", "stock.read", "orders.write");

        await RunAsync(database, PlanCatalogRepair);
        await RunAsync(database, PlanCatalogRepair);

        await using var db = database.CreateContext();
        (await Keys(db, role)).ShouldBe(["chat.write", "orders.write", "purchasing.read", "stock.read"]);
        (await db.PlatformAuditLogs.CountAsync(a => a.Action == "PlanFeatureCatalogRoleCopy")).ShouldBe(1);
    }

    [SqlFact]
    public async Task PlanCatalogRepair_WhenCopyRanWithoutMarker_OnlyWritesMarker()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var copied = await AddRoleAsync(database, "Stocker", "stock.read", "purchasing.read");
        var removedByShop = await AddRoleAsync(database, "Chatless", "orders.read");

        await RunAsync(database, PlanCatalogRepair);

        await using var db = database.CreateContext();
        (await Keys(db, copied)).ShouldBe(["purchasing.read", "stock.read"]);
        (await Keys(db, removedByShop)).ShouldBe(["orders.read"]);
        (await db.PlatformAuditLogs.CountAsync(a => a.Action == "PlanFeatureCatalogRoleCopy")).ShouldBe(1);
    }

    [SqlFact]
    public async Task PlanCatalogRepair_WhenMarkerExists_ChangesNothing()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var role = await AddRoleAsync(database, "Stocker", "stock.read");
        await using (var seed = database.CreateContext())
        {
            seed.PlatformAuditLogs.Add(new PlatformAuditLog { Id = Guid.NewGuid(), Action = "PlanFeatureCatalogRoleCopy", Timestamp = DateTime.UtcNow });
            await seed.SaveChangesAsync();
        }

        await RunAsync(database, PlanCatalogRepair);

        await using var db = database.CreateContext();
        (await Keys(db, role)).ShouldBe(["stock.read"]);
        (await db.PlatformAuditLogs.CountAsync(a => a.Action == "PlanFeatureCatalogRoleCopy")).ShouldBe(1);
    }

    [SqlFact]
    public async Task QuantityCheck_ClampsExistingRowsOnce_RecordsThem_AndAddsTrustedConstraint()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var product = await SqlSeed.ProductAsync(database, user.Id, "Latte", 100m);

        await using (var seed = database.CreateContext(new FixedTenant(TenantId)))
        {
            await seed.Database.ExecuteSqlRawAsync("ALTER TABLE dbo.OrderItems DROP CONSTRAINT CK_OrderItems_Quantity_Range");
            var order = new Order { Id = Guid.NewGuid(), CreatedAt = DateTime.UtcNow, CreatedBy = user.Id, StatusId = (int)OrderStatusEnum.Completed };
            seed.Orders.Add(order);
            await seed.SaveChangesAsync();
            foreach (var quantity in new[] { 2, 1, 5 })
            {
                seed.OrderItems.Add(new OrderItem { Id = Guid.NewGuid(), OrderId = order.Id, ProductId = product.Id, Quantity = quantity });
            }

            await seed.SaveChangesAsync();
            await seed.Database.ExecuteSqlRawAsync("UPDATE dbo.OrderItems SET Quantity = 0 WHERE Quantity = 1");
            await seed.Database.ExecuteSqlRawAsync("UPDATE dbo.OrderItems SET Quantity = 12000 WHERE Quantity = 5");
        }

        await RunAsync(database, QuantityCheck);
        await RunAsync(database, QuantityCheck);

        await using var db = database.CreateContext(new FixedTenant(TenantId));
        (await db.OrderItems.Select(i => i.Quantity).OrderBy(q => q).ToListAsync()).ShouldBe([1, 2, 9999]);
        (await db.Orders.CountAsync()).ShouldBe(1);
        (await db.PlatformAuditLogs.CountAsync(a => a.Action == "OrderItemQuantityClamped")).ShouldBe(2);
        var notTrusted = await db.Database
            .SqlQueryRaw<int>("SELECT CAST(is_not_trusted AS int) AS Value FROM sys.check_constraints WHERE name = 'CK_OrderItems_Quantity_Range'")
            .ToListAsync();
        notTrusted.ShouldBe([0]);
    }

    private static async Task RunAsync(SqlTestDatabase database, string scriptName)
    {
        var path = Path.Combine(FindSqlFolder(), scriptName);
        var text = await File.ReadAllTextAsync(path);

        await using var db = database.CreateContext();
        foreach (var batch in Regex.Split(text, @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase))
        {
            if (!string.IsNullOrWhiteSpace(batch))
            {
                await db.Database.ExecuteSqlRawAsync(batch);
            }
        }
    }

    private static string FindSqlFolder()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            var candidate = Path.Combine(directory.FullName, "tools", "sql");
            if (Directory.Exists(candidate))
            {
                return candidate;
            }

            directory = directory.Parent;
        }

        throw new DirectoryNotFoundException("tools/sql was not found above the test output folder.");
    }

    private static async Task<int> AddRoleAsync(SqlTestDatabase database, string name, params string[] keys)
    {
        await using var db = database.CreateContext();
        var role = new UserRole { Id = Interlocked.Increment(ref _nextRoleId), Name = name, TenantId = TenantId, IsSystem = false };
        db.UserRoles.Add(role);
        await db.SaveChangesAsync();
        foreach (var key in keys)
        {
            db.RolePermissions.Add(new RolePermission { RoleId = role.Id, PermissionKey = key });
        }

        await db.SaveChangesAsync();
        return role.Id;
    }

    private static async Task<List<string>> Keys(WTFDbContext db, int roleId) =>
        await db.RolePermissions.IgnoreQueryFilters().Where(p => p.RoleId == roleId).Select(p => p.PermissionKey).OrderBy(k => k).ToListAsync();
}
