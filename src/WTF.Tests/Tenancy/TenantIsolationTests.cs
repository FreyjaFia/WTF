using Microsoft.EntityFrameworkCore;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Tenancy;

public class TenantIsolationTests
{
    private static readonly Guid TenantA = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
    private static readonly Guid TenantB = Guid.Parse("bbbbbbbb-0000-0000-0000-000000000002");

    [Fact]
    public async Task Multi_ReadsOnlyTheCurrentTenantsRows()
    {
        var name = TestDb.NewName();
        await using (var a = TestDb.Create(name, new FakeTenant(true, TenantA)))
        {
            a.WasteReasons.Add(new WasteReason { Id = 1, Name = "A-size" });
            await a.SaveChangesAsync();
        }

        await using (var b = TestDb.Create(name, new FakeTenant(true, TenantB)))
        {
            b.WasteReasons.Add(new WasteReason { Id = 2, Name = "B-size" });
            await b.SaveChangesAsync();
        }

        await using var readA = TestDb.Create(name, new FakeTenant(true, TenantA));
        (await readA.WasteReasons.Select(t => t.Name).ToListAsync()).ShouldBe(["A-size"]);
        (await readA.WasteReasons.FindAsync(2)).ShouldBeNull();

        await using var readB = TestDb.Create(name, new FakeTenant(true, TenantB));
        (await readB.WasteReasons.Select(t => t.Name).ToListAsync()).ShouldBe(["B-size"]);
    }

    [Fact]
    public async Task Multi_StampsNewRowsWithTheCurrentTenant()
    {
        var name = TestDb.NewName();
        await using (var a = TestDb.Create(name, new FakeTenant(true, TenantA)))
        {
            a.WasteReasons.Add(new WasteReason { Id = 1, Name = "x" });
            await a.SaveChangesAsync();
        }

        await using var all = TestDb.Create(name);
        (await all.WasteReasons.SingleAsync()).TenantId.ShouldBe(TenantA);
    }

    [Fact]
    public async Task Multi_WithoutATenant_SeesNothingAndCannotSave()
    {
        var name = TestDb.NewName();
        await TestDb.SaveAsync(name, new WasteReason { Id = 1, Name = "x", TenantId = TenantA });

        await using var db = TestDb.Create(name, new FakeTenant(true, null));
        (await db.WasteReasons.ToListAsync()).ShouldBeEmpty();

        db.WasteReasons.Add(new WasteReason { Id = 2, Name = "y" });
        await Should.ThrowAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Multi_RefusesToSaveARowForAnotherTenant()
    {
        await using var db = TestDb.Create(TestDb.NewName(), new FakeTenant(true, TenantA));
        db.WasteReasons.Add(new WasteReason { Id = 1, Name = "x", TenantId = TenantB });

        await Should.ThrowAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Multi_RefusesToChangeOrDeleteARowOfAnotherTenant()
    {
        var name = TestDb.NewName();
        await TestDb.SaveAsync(name, new WasteReason { Id = 1, Name = "x", TenantId = TenantB });

        // Loaded without a filter (as platform code would), then saved as tenant A.
        await using var db = TestDb.Create(name, new FakeTenant(true, TenantA));
        var other = await db.WasteReasons.IgnoreQueryFilters().SingleAsync();
        other.Name = "hijacked";
        await Should.ThrowAsync<InvalidOperationException>(() => db.SaveChangesAsync());

        db.ChangeTracker.Clear();
        db.WasteReasons.Remove(await db.WasteReasons.IgnoreQueryFilters().SingleAsync());
        await Should.ThrowAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Multi_RefusesToMoveARowToAnotherTenant()
    {
        var name = TestDb.NewName();
        await TestDb.SaveAsync(name, new WasteReason { Id = 1, Name = "x", TenantId = TenantA });

        await using var db = TestDb.Create(name, new FakeTenant(true, TenantA));
        (await db.WasteReasons.SingleAsync()).TenantId = TenantB;

        await Should.ThrowAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Single_SeesEveryRowAndStampsTheDefaultTenant()
    {
        var name = TestDb.NewName();
        await TestDb.SaveAsync(
            name,
            new WasteReason { Id = 1, Name = "a", TenantId = TenantA },
            new WasteReason { Id = 2, Name = "none" });

        await using (var db = TestDb.Create(name, new FakeTenant(false, null, TenantDefaults.DefaultTenantId)))
        {
            (await db.WasteReasons.CountAsync()).ShouldBe(2);
            db.WasteReasons.Add(new WasteReason { Id = 3, Name = "new" });
            await db.SaveChangesAsync();
        }

        await using var read = TestDb.Create(name);
        (await read.WasteReasons.SingleAsync(t => t.Id == 3)).TenantId.ShouldBe(TenantDefaults.DefaultTenantId);
        (await read.WasteReasons.SingleAsync(t => t.Id == 1)).TenantId.ShouldBe(TenantA);
    }

    [Fact]
    public async Task ContextWithoutATenantService_BehavesAsBefore()
    {
        await using var db = TestDb.Create();
        db.WasteReasons.Add(new WasteReason { Id = 1, Name = "x" });
        await db.SaveChangesAsync();

        (await db.WasteReasons.SingleAsync()).TenantId.ShouldBe(Guid.Empty);
    }

    private sealed class FakeTenant(bool filterEnabled, Guid? tenantId, Guid? stampTenantId = null) : ICurrentTenant
    {
        public bool FilterEnabled => filterEnabled;

        public Guid? TenantId => tenantId;

        public Guid? StampTenantId => stampTenantId ?? tenantId;
    }
}
