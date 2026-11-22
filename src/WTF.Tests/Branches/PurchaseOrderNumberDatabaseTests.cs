using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Inventory.Purchasing;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Database;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Branches;

public class PurchaseOrderNumberDatabaseTests
{
    private static readonly Guid Tenant = TenantDefaults.DefaultTenantId;

    private static WTFDbContext In(SqlTestDatabase database, Guid active, params Guid[] visible) =>
        database.CreateContext(new FixedTenant(Tenant), new FixedBranch(visible, active, false));

    [SqlFact]
    public async Task PurchaseOrderNumbers_RunOnAcrossBranches_SoASecondBranchNeverReusesOne()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        Guid makati;
        Guid cebu;
        Guid supplier;
        Guid item;
        await using (var seed = database.CreateContext())
        {
            makati = await seed.Branches.Where(b => b.IsMain).Select(b => b.Id).SingleAsync();
            var branch = SqlTestDatabase.MainBranch(Tenant, "CEB");
            branch.IsMain = false;
            branch.Name = "Cebu";
            seed.Branches.Add(branch);
            cebu = branch.Id;
            var newSupplier = new Supplier { Name = "Metro Dairy", IsActive = true, CreatedAt = DateTime.UtcNow, CreatedBy = user.Id };
            seed.Suppliers.Add(newSupplier);
            var newItem = new Item { Id = Guid.NewGuid(), Name = "Oat Milk", UnitName = "bottle", IsActive = true, CreatedAt = DateTime.UtcNow, CreatedBy = user.Id };
            seed.Items.Add(newItem);
            await seed.SaveChangesAsync();
            supplier = newSupplier.Id;
            item = newItem.Id;
        }

        var fields = new PurchaseOrderFields
        {
            SupplierId = supplier,
            Lines = [new PurchaseOrderLineRequest { ItemId = item, Packs = 2, UnitsPerPack = 12, PackPrice = 840, PackName = "carton" }]
        };

        await using (var inMakati = In(database, makati, makati, cebu))
        {
            var first = await new CreatePurchaseOrderHandler(inMakati, TestRequest.As(user.Id), TestFakes.Audit())
                .Handle(new CreatePurchaseOrderCommand(fields), CancellationToken.None);
            first.Summary.PoNumber.ShouldBe(1);
        }

        await using var inCebu = In(database, cebu, cebu);
        var second = await new CreatePurchaseOrderHandler(inCebu, TestRequest.As(user.Id), TestFakes.Audit())
            .Handle(new CreatePurchaseOrderCommand(fields), CancellationToken.None);

        second.Summary.PoNumber.ShouldBe(2);
    }
}
