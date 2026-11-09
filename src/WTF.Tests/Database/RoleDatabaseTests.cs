using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using System.Text.RegularExpressions;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Features.Roles;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

/// <summary>Custom roles against a real SQL Server: the id sequence, the per-shop unique names, the shop filter, and the role script.</summary>
public class RoleDatabaseTests
{
    private static readonly Guid ShopA = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
    private static readonly Guid ShopB = Guid.Parse("bbbbbbbb-0000-0000-0000-000000000002");

    private static async Task SeedShopsAsync(SqlTestDatabase database)
    {
        await using var db = database.CreateContext();
        db.Tenants.AddRange(
            new Tenant { Id = ShopA, Name = "A", Slug = "a", Status = 2, CreatedAt = DateTime.UtcNow },
            new Tenant { Id = ShopB, Name = "B", Slug = "b", Status = 2, CreatedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
    }

    private static CreateRoleHandler Create(WTFDbContext db, Guid actor) =>
        new(db, TestRequest.As(actor, AppRoles.Owner), TestFakes.Audit(), new RolePermissionCache(TimeProvider.System));

    [SqlFact]
    public async Task CreateRole_TakesIdsFromTheSequence_AndTheSameNameIsFreeInAnotherShop()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SeedShopsAsync(database);
        var actor = Guid.NewGuid();

        await using var a = database.CreateContext(new FixedTenant(ShopA));
        var first = await Create(a, actor).Handle(new CreateRoleCommand("Shift Lead", null, ["orders.write"]), CancellationToken.None);

        await using var b = database.CreateContext(new FixedTenant(ShopB));
        var second = await Create(b, actor).Handle(new CreateRoleCommand("Shift Lead", null, ["orders.read"]), CancellationToken.None);

        first.Id.ShouldBe(100);
        second.Id.ShouldBe(101);

        await using var readA = database.CreateContext(new FixedTenant(ShopA));
        var roles = await new GetRolesHandler(readA).Handle(new GetRolesQuery(), CancellationToken.None);
        roles.Where(r => !r.IsSystem).Select(r => r.Id).ShouldBe([100]);
        roles.Count(r => r.IsSystem).ShouldBe(6);
        (await new GetRoleByIdHandler(readA).Handle(new GetRoleByIdQuery(101), CancellationToken.None)).ShouldBeNull();
    }

    [SqlFact]
    public async Task UniqueIndexes_RefuseADuplicateNameInOneShopAndADuplicateBuiltInName()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SeedShopsAsync(database);

        await using (var db = database.CreateContext())
        {
            db.UserRoles.Add(new UserRole { Id = 200, Name = "Barista", TenantId = ShopA });
            await db.SaveChangesAsync();
        }

        await using (var db = database.CreateContext())
        {
            db.UserRoles.Add(new UserRole { Id = 201, Name = "Barista", TenantId = ShopA });
            await Should.ThrowAsync<DbUpdateException>(() => db.SaveChangesAsync());
        }

        await using (var db = database.CreateContext())
        {
            db.UserRoles.Add(new UserRole { Id = 202, Name = "Barista", TenantId = ShopB });
            await db.SaveChangesAsync();
        }

        await using (var db = database.CreateContext())
        {
            db.UserRoles.Add(new UserRole { Id = 203, Name = "Admin" });
            await Should.ThrowAsync<DbUpdateException>(() => db.SaveChangesAsync());
        }
    }

    [SqlFact]
    public async Task DeletingARole_RemovesItsPermissionRows()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SeedShopsAsync(database);
        var actor = Guid.NewGuid();

        await using var a = database.CreateContext(new FixedTenant(ShopA));
        var role = await Create(a, actor).Handle(new CreateRoleCommand("Temp", null, ["orders.write"]), CancellationToken.None);

        await using var again = database.CreateContext(new FixedTenant(ShopA));
        var delete = new DeleteRoleHandler(again, TestRequest.As(actor, AppRoles.Owner), TestFakes.Audit(), new RolePermissionCache(TimeProvider.System));
        (await delete.Handle(new DeleteRoleCommand(role.Id), CancellationToken.None)).ShouldBeTrue();

        await using var check = database.CreateContext();
        (await check.RolePermissions.CountAsync(p => p.RoleId == role.Id)).ShouldBe(0);
    }

    [SqlFact]
    public async Task RoleScript_AddsTheColumnsTablesAndSequence_KeepsData_AndRunsTwice()
    {
        var name = "WTF_Test_Roles_" + Guid.NewGuid().ToString("N");
        var master = SqlServerAvailability.ServerConnectionString;
        var scoped = new SqlConnectionStringBuilder(master) { InitialCatalog = name }.ConnectionString;

        await using (var connection = new SqlConnection(master))
        {
            await connection.OpenAsync();
            await new SqlCommand($"CREATE DATABASE [{name}]", connection).ExecuteNonQueryAsync();
        }

        try
        {
            await using var db = new SqlConnection(scoped);
            await db.OpenAsync();
            await Exec(db, "CREATE TABLE dbo.Tenants (Id uniqueidentifier NOT NULL PRIMARY KEY)");
            await Exec(db, "CREATE TABLE dbo.UserRoles (Id int NOT NULL PRIMARY KEY, Name varchar(30) NOT NULL, CONSTRAINT UQ_UserRoles_Name UNIQUE (Name))");
            await Exec(db, "INSERT dbo.UserRoles (Id, Name) VALUES (1,'Admin'),(2,'Cashier'),(3,'AdminViewer'),(4,'Owner'),(5,'ItemManager'),(6,'StockManager'),(7,'Barista')");

            var script = await File.ReadAllTextAsync(Path.Combine(RepoRoot(), "tools", "sql", "20261119_add_role_management.sql"));
            var batches = Regex.Split(script, @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase).Where(b => b.Trim().Length > 0).ToList();

            for (var run = 0; run < 2; run++)
            {
                foreach (var batch in batches)
                {
                    await Exec(db, batch);
                }
            }

            (await Scalar(db, "SELECT COUNT(*) FROM dbo.UserRoles")).ShouldBe(7);
            (await Scalar(db, "SELECT COUNT(*) FROM dbo.UserRoles WHERE IsSystem = 1 AND TenantId IS NULL")).ShouldBe(6);
            (await Scalar(db, "SELECT COUNT(*) FROM dbo.UserRoles WHERE Name = 'Barista' AND IsSystem = 0")).ShouldBe(1);
            (await Scalar(db, "SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserRoles') AND name IN ('TenantId','IsSystem','Description','CreatedAt')")).ShouldBe(4);
            (await Scalar(db, "SELECT max_length FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserRoles') AND name = 'Name'")).ShouldBe(100);
            (await Scalar(db, "SELECT COUNT(*) FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.UserRoles') AND name IN ('UX_UserRoles_SystemName','UX_UserRoles_TenantName')")).ShouldBe(2);
            (await Scalar(db, "SELECT COUNT(*) FROM sys.indexes WHERE name = 'UQ_UserRoles_Name'")).ShouldBe(0);
            (await Scalar(db, "SELECT COUNT(*) FROM sys.tables WHERE name = 'RolePermissions'")).ShouldBe(1);
            (await Scalar(db, "SELECT CAST(start_value AS int) FROM sys.sequences WHERE name = 'UserRoleIdSeq'")).ShouldBe(100);
        }
        finally
        {
            SqlConnection.ClearAllPools();
            await using var connection = new SqlConnection(master);
            await connection.OpenAsync();
            await new SqlCommand($"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}]", connection).ExecuteNonQueryAsync();
        }
    }

    private static async Task Exec(SqlConnection connection, string sql) =>
        await new SqlCommand(sql, connection).ExecuteNonQueryAsync();

    private static async Task<int> Scalar(SqlConnection connection, string sql) =>
        Convert.ToInt32(await new SqlCommand(sql, connection).ExecuteScalarAsync());

    private static string RepoRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !Directory.Exists(Path.Combine(directory.FullName, "tools", "sql")))
        {
            directory = directory.Parent;
        }

        return directory?.FullName ?? throw new DirectoryNotFoundException("tools/sql not found above the test output.");
    }

    private sealed class FixedTenant(Guid id) : ICurrentTenant
    {
        public bool FilterEnabled => true;

        public Guid? TenantId => id;

        public Guid? StampTenantId => id;
    }
}
