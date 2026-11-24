using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Branches;
using WTF.Api.Features.Branches.Enums;
using WTF.Api.Features.Users.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Branches;

public class UserBranchAccessScopeTests
{
    private static readonly Guid Tenant = TenantDefaults.DefaultTenantId;

    private readonly string _dbName = TestDb.NewName();
    private readonly Guid _makati;
    private readonly Guid _cebu = Guid.NewGuid();
    private readonly Guid _davao = Guid.NewGuid();
    private readonly Guid _manager = Guid.NewGuid();
    private readonly Guid _owner = Guid.NewGuid();
    private readonly Guid _makatiCashier = Guid.NewGuid();
    private readonly Guid _sharedCashier = Guid.NewGuid();
    private readonly Guid _davaoCashier = Guid.NewGuid();

    public UserBranchAccessScopeTests()
    {
        TestDb.SeedSystemRoles(_dbName);
        using var db = TestDb.Create(_dbName);
        _makati = db.Branches.Single(b => b.IsMain).Id;
        db.Branches.AddRange(NewBranch(_cebu, "Cebu", "CEB"), NewBranch(_davao, "Davao", "DVO"));
        db.Users.AddRange(
            NewUser(_manager, "ana.manager", UserRoleEnum.Admin, BranchScopeEnum.Selected),
            NewUser(_owner, "owner", UserRoleEnum.Owner, BranchScopeEnum.All),
            NewUser(_makatiCashier, "cara.makati", UserRoleEnum.Cashier, BranchScopeEnum.Selected),
            NewUser(_sharedCashier, "ben.shared", UserRoleEnum.Cashier, BranchScopeEnum.Selected),
            NewUser(_davaoCashier, "dino.davao", UserRoleEnum.Cashier, BranchScopeEnum.Selected));
        db.UserBranches.AddRange(
            Link(_manager, _cebu),
            Link(_manager, _davao),
            Link(_makatiCashier, _makati),
            Link(_sharedCashier, _cebu),
            Link(_sharedCashier, _makati),
            Link(_davaoCashier, _davao));
        db.SaveChanges();
    }

    private static Branch NewBranch(Guid id, string name, string code) => new()
    {
        Id = id,
        TenantId = Tenant,
        Name = name,
        Code = code,
        TimeZone = "Asia/Manila",
        IsActive = true,
        CreatedAt = DateTime.UtcNow
    };

    private static UserBranch Link(Guid userId, Guid branchId) => new() { UserId = userId, BranchId = branchId, TenantId = Tenant, CreatedAt = DateTime.UtcNow };

    private static User NewUser(Guid id, string username, UserRoleEnum role, BranchScopeEnum scope) => new()
    {
        Id = id,
        TenantId = Tenant,
        Username = username,
        FirstName = username,
        LastName = "Reyes",
        PasswordHash = "x",
        IsActive = true,
        RoleId = (int)role,
        BranchScope = (byte)scope,
        CreatedAt = DateTime.UtcNow,
        CreatedBy = id
    };

    private FixedBranch ManagerScope() => new([_cebu, _davao], _cebu, true);

    private WTFDbContext ManagerDb() => TestDb.Create(_dbName, new FixedTenant(Tenant), ManagerScope());

    [Fact]
    public async Task ALimitedManager_CannotReadTheBranchAccessOfSomeoneOutsideTheirBranches()
    {
        await using var db = ManagerDb();
        var handler = new GetUserBranchAccessHandler(db, TestRequest.As(_manager, AppRoles.Admin), ManagerScope());

        (await handler.Handle(new GetUserBranchAccessQuery(_owner), CancellationToken.None)).ShouldBeNull();
        (await handler.Handle(new GetUserBranchAccessQuery(_makatiCashier), CancellationToken.None)).ShouldBeNull();

        var inside = await handler.Handle(new GetUserBranchAccessQuery(_davaoCashier), CancellationToken.None);
        inside!.BranchIds.ShouldBe([_davao]);
    }

    [Fact]
    public async Task ALimitedManager_CannotMakeABranchOutsideTheirOwnTheDefaultOfSomeone()
    {
        await using var db = ManagerDb();
        var handler = new SetUserBranchAccessHandler(db, TestRequest.As(_manager, AppRoles.Admin), TestFakes.Audit(), ManagerScope(), new BranchScopeCache(TimeProvider.System));

        var result = await handler.Handle(new SetUserBranchAccessCommand(_sharedCashier, false, [_cebu], _makati), CancellationToken.None);

        result!.BranchIds.ShouldContain(_makati);
        result.DefaultBranchId.ShouldNotBe(_makati);
    }

    [Fact]
    public async Task ALimitedManager_CannotMoveClosedBranchStaffToABranchTheyDoNotWorkIn()
    {
        await using var db = ManagerDb();
        var handler = new CloseBranchHandler(db, TestRequest.As(_manager, AppRoles.Admin), TestFakes.Audit(), ManagerScope(), new BranchScopeCache(TimeProvider.System));

        await Should.ThrowAsync<ForbiddenActionException>(
            () => handler.Handle(new CloseBranchCommand(_davao, _makati), CancellationToken.None));

        await using var check = TestDb.Create(_dbName);
        (await check.UserBranches.CountAsync(u => u.UserId == _davaoCashier && u.BranchId == _makati)).ShouldBe(0);
    }
}
