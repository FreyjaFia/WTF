using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Products;
using WTF.Api.Features.Products.DTOs;
using WTF.Api.Features.Products.Enums;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

public class ProductAddOnDatabaseTests
{
    [SqlFact]
    public async Task AssigningAnAddOn_SavesAnActiveLink()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var admin = await SqlSeed.UserAsync(database, roleId: 1);
        var drink = await SqlSeed.ProductAsync(database, admin.Id, "Latte", 150m);
        var extra = await SqlSeed.ProductAsync(database, admin.Id, "Extra Shot", 30m);
        await using (var setup = database.CreateContext())
        {
            await setup.Products.Where(p => p.Id == extra.Id).ExecuteUpdateAsync(s => s.SetProperty(p => p.IsAddOn, true));
        }

        await using (var db = database.CreateContext())
        {
            var assigned = await new AssignProductAddOnsHandler(db).Handle(
                new AssignProductAddOnsCommand
                {
                    ProductId = drink.Id,
                    AddOns = [new ProductAddOnAssignmentDto(extra.Id, AddOnTypeEnum.Extra)],
                },
                CancellationToken.None);
            assigned.ShouldBeTrue();
        }

        await using var check = database.CreateContext();
        var link = await check.ProductAddOns.SingleAsync();
        link.IsActive.ShouldBeTrue();
        (await check.ProductAddOns.CountAsync(pa => pa.IsActive)).ShouldBe(1);
    }
}
