using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Branches;
using WTF.Api.Features.Branches.Enums;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Users.Enums;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Database;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Branches;

public class BranchHandlerDatabaseTests
{
    private static readonly Guid Tenant = TenantDefaults.DefaultTenantId;

    private sealed record Shop(SqlTestDatabase Database, Guid OwnerId, Guid Main);

    private static async Task<Shop> OpenShopAsync(int? maxBranches = null)
    {
        var database = await SqlTestDatabase.CreateAsync();
        var owner = await SqlSeed.UserAsync(database, "owner", (int)UserRoleEnum.Owner);
        await using var db = database.CreateContext();
        var main = await db.Branches.Where(b => b.IsMain).Select(b => b.Id).SingleAsync();

        if (maxBranches is not null)
        {
            var plan = new Plan { Code = "test", Name = "Test", MonthlyPrice = 1, Features = "branches", MaxBranches = maxBranches, IsActive = true, SortOrder = 1 };
            db.Plans.Add(plan);
            await db.SaveChangesAsync();
            db.TenantSubscriptions.Add(new TenantSubscription { TenantId = Tenant, PlanId = plan.Id, CurrentPeriodStart = DateTime.UtcNow, CurrentPeriodEnd = DateTime.UtcNow.AddDays(30), GraceDays = 3, UpdatedAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
        }

        return new Shop(database, owner.Id, main);
    }

    private static CurrentBranch AllBranches(Guid[] ids)
    {
        var current = new CurrentBranch();
        current.Resolve(ids, false, null, true);
        return current;
    }

    private static CurrentBranch Limited(Guid[] ids)
    {
        var current = new CurrentBranch();
        current.Resolve(ids, true, ids[0], false);
        return current;
    }

    private static CreateBranchHandler Creator(Shop shop, Microsoft.EntityFrameworkCore.DbContext db, ICurrentBranch? branch = null, Guid? actor = null) =>
        new((WTF.Domain.Data.WTFDbContext)db, TestRequest.As(actor ?? shop.OwnerId, AppRoles.Owner), TestFakes.Audit(), new FixedTenant(Tenant), branch ?? AllBranches([shop.Main]), new BranchScopeCache(TimeProvider.System));

    private static async Task<Guid> AddBranchAsync(Shop shop, string name, string code)
    {
        await using var db = shop.Database.CreateContext(new FixedTenant(Tenant));
        var created = await Creator(shop, db).Handle(new CreateBranchCommand(name, code, null, null), CancellationToken.None);
        return created.Id;
    }

    [SqlFact]
    public async Task Create_AddsAnOpenBranchWithNoStaff_AndTheCodeIsUpperCased()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        var id = await AddBranchAsync(shop, "Cebu", "ceb");

        await using var db = shop.Database.CreateContext(new FixedTenant(Tenant));
        var branch = await db.Branches.SingleAsync(b => b.Id == id);
        branch.Code.ShouldBe("CEB");
        branch.IsActive.ShouldBeTrue();
        branch.IsMain.ShouldBeFalse();
        (await db.UserBranches.CountAsync(u => u.BranchId == id)).ShouldBe(0);
    }

    [SqlFact]
    public async Task Create_RefusesADuplicateCode_AndABadCode()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        await AddBranchAsync(shop, "Cebu", "CEB");

        await using var db = shop.Database.CreateContext(new FixedTenant(Tenant));
        await Should.ThrowAsync<InvalidOperationException>(() => Creator(shop, db).Handle(new CreateBranchCommand("Cebu 2", "ceb", null, null), CancellationToken.None));
        await Should.ThrowAsync<InvalidOperationException>(() => Creator(shop, db).Handle(new CreateBranchCommand("Bad", "x", null, null), CancellationToken.None));
        await Should.ThrowAsync<InvalidOperationException>(() => Creator(shop, db).Handle(new CreateBranchCommand("", "OK", null, null), CancellationToken.None));
    }

    [SqlFact]
    public async Task Create_IsRefusedOverThePlanCap_AndReopeningCountsToo()
    {
        var shop = await OpenShopAsync(maxBranches: 2);
        await using var _ = shop.Database;
        var cebu = await AddBranchAsync(shop, "Cebu", "CEB");

        await using (var db = shop.Database.CreateContext(new FixedTenant(Tenant)))
        {
            var ex = await Should.ThrowAsync<ForbiddenActionException>(() => Creator(shop, db).Handle(new CreateBranchCommand("Davao", "DVO", null, null), CancellationToken.None));
            ex.Code.ShouldBe(BranchRules.BranchLimitCode);
        }

        await using (var db = shop.Database.CreateContext(new FixedTenant(Tenant)))
        {
            var close = new CloseBranchHandler(db, TestRequest.As(shop.OwnerId, AppRoles.Owner), TestFakes.Audit(), AllBranches([shop.Main, cebu]), new BranchScopeCache(TimeProvider.System));
            await close.Handle(new CloseBranchCommand(cebu, null), CancellationToken.None);
        }

        await AddBranchAsync(shop, "Davao", "DVO");

        await using (var db = shop.Database.CreateContext(new FixedTenant(Tenant)))
        {
            var reopen = new ReopenBranchHandler(db, TestRequest.As(shop.OwnerId, AppRoles.Owner), TestFakes.Audit(), new FixedTenant(Tenant), AllBranches([shop.Main, cebu]), new BranchScopeCache(TimeProvider.System));
            await Should.ThrowAsync<ForbiddenActionException>(() => reopen.Handle(new ReopenBranchCommand(cebu), CancellationToken.None));
        }
    }

    [SqlFact]
    public async Task Close_IsRefusedForMain_ForTheLastBranch_AndWhileOrdersAreOpen()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        var cebu = await AddBranchAsync(shop, "Cebu", "CEB");

        await using (var db = shop.Database.CreateContext(new FixedTenant(Tenant), new FixedBranch([cebu], cebu, false)))
        {
            db.Orders.Add(new Order { Id = Guid.NewGuid(), StatusId = (int)OrderStatusEnum.Pending, CreatedAt = DateTime.UtcNow, CreatedBy = shop.OwnerId });
            await db.SaveChangesAsync();
        }

        await using var read = shop.Database.CreateContext(new FixedTenant(Tenant));
        var close = new CloseBranchHandler(read, TestRequest.As(shop.OwnerId, AppRoles.Owner), TestFakes.Audit(), AllBranches([shop.Main, cebu]), new BranchScopeCache(TimeProvider.System));

        var main = await Should.ThrowAsync<InvalidOperationException>(() => close.Handle(new CloseBranchCommand(shop.Main, null), CancellationToken.None));
        main.Message.ShouldContain("main branch");

        var open = await Should.ThrowAsync<InvalidOperationException>(() => close.Handle(new CloseBranchCommand(cebu, null), CancellationToken.None));
        open.Message.ShouldContain("still open");
    }

    [SqlFact]
    public async Task Close_MovesStrandedStaffToTheChosenBranch_AndKeepsTheHistory()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        var cebu = await AddBranchAsync(shop, "Cebu", "CEB");
        var cashier = await SqlSeed.UserAsync(shop.Database, "cashier", (int)UserRoleEnum.Cashier);

        await using (var seed = shop.Database.CreateContext())
        {
            var user = await seed.Users.SingleAsync(u => u.Id == cashier.Id);
            user.BranchScope = (byte)BranchScopeEnum.Selected;
            user.DefaultBranchId = cebu;
            seed.UserBranches.Add(new UserBranch { UserId = cashier.Id, BranchId = cebu, TenantId = Tenant, CreatedAt = DateTime.UtcNow });
            seed.Orders.Add(new Order { Id = Guid.NewGuid(), StatusId = (int)OrderStatusEnum.Completed, CreatedAt = DateTime.UtcNow, CreatedBy = shop.OwnerId, BranchId = cebu });
            await seed.SaveChangesAsync();
        }

        await using var db = shop.Database.CreateContext(new FixedTenant(Tenant));
        var handler = new CloseBranchHandler(db, TestRequest.As(shop.OwnerId, AppRoles.Owner), TestFakes.Audit(), AllBranches([shop.Main, cebu]), new BranchScopeCache(TimeProvider.System));

        var check = await new GetBranchCloseCheckHandler(db, AllBranches([shop.Main, cebu])).Handle(new GetBranchCloseCheckQuery(cebu), CancellationToken.None);
        check!.CanClose.ShouldBeTrue();
        check.StaffWithNoOtherBranch.Select(s => s.Username).ShouldBe(["cashier"]);

        await Should.ThrowAsync<InvalidOperationException>(() => handler.Handle(new CloseBranchCommand(cebu, null), CancellationToken.None));
        var closed = await handler.Handle(new CloseBranchCommand(cebu, shop.Main), CancellationToken.None);
        closed!.IsActive.ShouldBeFalse();

        await using var verify = shop.Database.CreateContext(new FixedTenant(Tenant));
        (await verify.UserBranches.Where(u => u.UserId == cashier.Id).Select(u => u.BranchId).ToListAsync()).ShouldBe([shop.Main]);
        (await verify.Users.SingleAsync(u => u.Id == cashier.Id)).DefaultBranchId.ShouldBe(shop.Main);
        (await verify.Orders.CountAsync(o => o.BranchId == cebu)).ShouldBe(1);
    }

    [SqlFact]
    public async Task Close_CountsTheOtherOpenBranchesOfAPerson_EvenWhenTheOwnerWorksInAnotherBranch()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        var davao = await AddBranchAsync(shop, "Davao", "DVO");
        var cebu = await AddBranchAsync(shop, "Cebu", "CEB");
        var cashier = await SqlSeed.UserAsync(shop.Database, "cashier", (int)UserRoleEnum.Cashier);

        await using (var seed = shop.Database.CreateContext())
        {
            var user = await seed.Users.SingleAsync(u => u.Id == cashier.Id);
            user.BranchScope = (byte)BranchScopeEnum.Selected;
            seed.UserBranches.AddRange(
                new UserBranch { UserId = cashier.Id, BranchId = cebu, TenantId = Tenant, CreatedAt = DateTime.UtcNow },
                new UserBranch { UserId = cashier.Id, BranchId = davao, TenantId = Tenant, CreatedAt = DateTime.UtcNow });
            await seed.SaveChangesAsync();
        }

        var ownerInMain = new CurrentBranch();
        ownerInMain.Resolve([shop.Main, davao, cebu], false, shop.Main, false);
        await using var db = shop.Database.CreateContext(new FixedTenant(Tenant), ownerInMain);

        var check = await new GetBranchCloseCheckHandler(db, ownerInMain).Handle(new GetBranchCloseCheckQuery(cebu), CancellationToken.None);
        check!.StaffWithNoOtherBranch.ShouldBeEmpty();

        var handler = new CloseBranchHandler(db, TestRequest.As(shop.OwnerId, AppRoles.Owner), TestFakes.Audit(), ownerInMain, new BranchScopeCache(TimeProvider.System));
        var closed = await handler.Handle(new CloseBranchCommand(cebu, davao), CancellationToken.None);
        closed!.IsActive.ShouldBeFalse();

        await using var verify = shop.Database.CreateContext(new FixedTenant(Tenant));
        (await verify.UserBranches.Where(u => u.UserId == cashier.Id).Select(u => u.BranchId).ToListAsync()).ShouldBe([davao]);
    }

    [SqlFact]
    public async Task MakeMain_SwapsTheFlag_AndKeepsExactlyOneMain()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        var cebu = await AddBranchAsync(shop, "Cebu", "CEB");

        await using (var db = shop.Database.CreateContext(new FixedTenant(Tenant)))
        {
            var handler = new MakeMainBranchHandler(db, TestRequest.As(shop.OwnerId, AppRoles.Owner), TestFakes.Audit(), AllBranches([shop.Main, cebu]), new BranchScopeCache(TimeProvider.System));
            await handler.Handle(new MakeMainBranchCommand(cebu), CancellationToken.None);
        }

        await using var verify = shop.Database.CreateContext(new FixedTenant(Tenant));
        (await verify.Branches.Where(b => b.IsMain).Select(b => b.Id).ToListAsync()).ShouldBe([cebu]);
    }

    [SqlFact]
    public async Task Access_TheOwnerCannotBeLimited_AndALimitedManagerStaysInsideTheirBranches()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        var cebu = await AddBranchAsync(shop, "Cebu", "CEB");
        var davao = await AddBranchAsync(shop, "Davao", "DVO");
        var manager = await SqlSeed.UserAsync(shop.Database, "manager", (int)UserRoleEnum.Admin);
        var cashier = await SqlSeed.UserAsync(shop.Database, "cashier", (int)UserRoleEnum.Cashier);

        await using (var seed = shop.Database.CreateContext())
        {
            seed.UserBranches.AddRange(
                new UserBranch { UserId = manager.Id, BranchId = cebu, TenantId = Tenant, CreatedAt = DateTime.UtcNow },
                new UserBranch { UserId = cashier.Id, BranchId = cebu, TenantId = Tenant, CreatedAt = DateTime.UtcNow });
            (await seed.Users.SingleAsync(u => u.Id == manager.Id)).BranchScope = (byte)BranchScopeEnum.Selected;
            (await seed.Users.SingleAsync(u => u.Id == cashier.Id)).BranchScope = (byte)BranchScopeEnum.Selected;
            await seed.SaveChangesAsync();
        }

        await using var db = shop.Database.CreateContext(new FixedTenant(Tenant));
        var asOwner = new SetUserBranchAccessHandler(db, TestRequest.As(shop.OwnerId, AppRoles.Owner), TestFakes.Audit(), AllBranches([shop.Main, cebu, davao]), new BranchScopeCache(TimeProvider.System));
        await Should.ThrowAsync<InvalidOperationException>(() => asOwner.Handle(new SetUserBranchAccessCommand(shop.OwnerId, false, [cebu], null), CancellationToken.None));

        var asManager = new SetUserBranchAccessHandler(db, TestRequest.As(manager.Id, AppRoles.Admin), TestFakes.Audit(), Limited([cebu]), new BranchScopeCache(TimeProvider.System));
        await Should.ThrowAsync<ForbiddenActionException>(() => asManager.Handle(new SetUserBranchAccessCommand(cashier.Id, true, null, null), CancellationToken.None));
        await Should.ThrowAsync<ForbiddenActionException>(() => asManager.Handle(new SetUserBranchAccessCommand(cashier.Id, false, [davao], null), CancellationToken.None));
        await Should.ThrowAsync<ForbiddenActionException>(() => asManager.Handle(new SetUserBranchAccessCommand(shop.OwnerId, false, [cebu], null), CancellationToken.None));

        var saved = await asOwner.Handle(new SetUserBranchAccessCommand(cashier.Id, false, [cebu, davao], davao), CancellationToken.None);
        saved!.BranchIds.OrderBy(i => i).ShouldBe(new[] { cebu, davao }.OrderBy(i => i));
        saved.DefaultBranchId.ShouldBe(davao);
    }
}
