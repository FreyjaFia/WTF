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
            a.AddOnTypes.Add(new AddOnType { Id = 1, Name = "A-size" });
            await a.SaveChangesAsync();
        }

        await using (var b = TestDb.Create(name, new FakeTenant(true, TenantB)))
        {
            b.AddOnTypes.Add(new AddOnType { Id = 2, Name = "B-size" });
            await b.SaveChangesAsync();
        }

        await using var readA = TestDb.Create(name, new FakeTenant(true, TenantA));
        (await readA.AddOnTypes.Select(t => t.Name).ToListAsync()).ShouldBe(["A-size"]);
        (await readA.AddOnTypes.FindAsync(2)).ShouldBeNull();

        await using var readB = TestDb.Create(name, new FakeTenant(true, TenantB));
        (await readB.AddOnTypes.Select(t => t.Name).ToListAsync()).ShouldBe(["B-size"]);
    }

    [Fact]
    public async Task Multi_StampsNewRowsWithTheCurrentTenant()
    {
        var name = TestDb.NewName();
        await using (var a = TestDb.Create(name, new FakeTenant(true, TenantA)))
        {
            a.AddOnTypes.Add(new AddOnType { Id = 1, Name = "x" });
            await a.SaveChangesAsync();
        }

        await using var all = TestDb.Create(name);
        (await all.AddOnTypes.SingleAsync()).TenantId.ShouldBe(TenantA);
    }

    [Fact]
    public async Task Multi_WithoutATenant_SeesNothingAndCannotSave()
    {
        var name = TestDb.NewName();
        await TestDb.SaveAsync(name, new AddOnType { Id = 1, Name = "x", TenantId = TenantA });

        await using var db = TestDb.Create(name, new FakeTenant(true, null));
        (await db.AddOnTypes.ToListAsync()).ShouldBeEmpty();

        db.AddOnTypes.Add(new AddOnType { Id = 2, Name = "y" });
        await Should.ThrowAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Multi_RefusesToSaveARowForAnotherTenant()
    {
        await using var db = TestDb.Create(TestDb.NewName(), new FakeTenant(true, TenantA));
        db.AddOnTypes.Add(new AddOnType { Id = 1, Name = "x", TenantId = TenantB });

        await Should.ThrowAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Multi_RefusesToChangeOrDeleteARowOfAnotherTenant()
    {
        var name = TestDb.NewName();
        await TestDb.SaveAsync(name, new AddOnType { Id = 1, Name = "x", TenantId = TenantB });

        // Loaded without a filter (as platform code would), then saved as tenant A.
        await using var db = TestDb.Create(name, new FakeTenant(true, TenantA));
        var other = await db.AddOnTypes.IgnoreQueryFilters().SingleAsync();
        other.Name = "hijacked";
        await Should.ThrowAsync<InvalidOperationException>(() => db.SaveChangesAsync());

        db.ChangeTracker.Clear();
        db.AddOnTypes.Remove(await db.AddOnTypes.IgnoreQueryFilters().SingleAsync());
        await Should.ThrowAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Multi_RefusesToMoveARowToAnotherTenant()
    {
        var name = TestDb.NewName();
        await TestDb.SaveAsync(name, new AddOnType { Id = 1, Name = "x", TenantId = TenantA });

        await using var db = TestDb.Create(name, new FakeTenant(true, TenantA));
        (await db.AddOnTypes.SingleAsync()).TenantId = TenantB;

        await Should.ThrowAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Single_SeesEveryRowAndStampsTheDefaultTenant()
    {
        var name = TestDb.NewName();
        await TestDb.SaveAsync(
            name,
            new AddOnType { Id = 1, Name = "a", TenantId = TenantA },
            new AddOnType { Id = 2, Name = "none" });

        await using (var db = TestDb.Create(name, new FakeTenant(false, null, TenantDefaults.DefaultTenantId)))
        {
            (await db.AddOnTypes.CountAsync()).ShouldBe(2);
            db.AddOnTypes.Add(new AddOnType { Id = 3, Name = "new" });
            await db.SaveChangesAsync();
        }

        await using var read = TestDb.Create(name);
        (await read.AddOnTypes.SingleAsync(t => t.Id == 3)).TenantId.ShouldBe(TenantDefaults.DefaultTenantId);
        (await read.AddOnTypes.SingleAsync(t => t.Id == 1)).TenantId.ShouldBe(TenantA);
    }

    [Fact]
    public async Task ContextWithoutATenantService_BehavesAsBefore()
    {
        await using var db = TestDb.Create();
        db.AddOnTypes.Add(new AddOnType { Id = 1, Name = "x" });
        await db.SaveChangesAsync();

        (await db.AddOnTypes.SingleAsync()).TenantId.ShouldBe(Guid.Empty);
    }

    private sealed class FakeTenant(bool filterEnabled, Guid? tenantId, Guid? stampTenantId = null) : ICurrentTenant
    {
        public bool FilterEnabled => filterEnabled;

        public Guid? TenantId => tenantId;

        public Guid? StampTenantId => stampTenantId ?? tenantId;
    }
}
