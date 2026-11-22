using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Features.Branches.Enums;
using WTF.Api.Features.Users;
using WTF.Api.Features.Users.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Branches;

public class UserBranchScopeTests
{
    private static readonly Guid Tenant = TenantDefaults.DefaultTenantId;

    private readonly string _dbName = TestDb.NewName();
    private readonly Guid _makati;
    private readonly Guid _cebu = Guid.NewGuid();
    private readonly Guid _manager = Guid.NewGuid();
    private readonly Guid _cebuCashier = Guid.NewGuid();
    private readonly Guid _makatiCashier = Guid.NewGuid();
    private readonly Guid _owner = Guid.NewGuid();

    public UserBranchScopeTests()
    {
        TestDb.SeedSystemRoles(_dbName);
        using var db = TestDb.Create(_dbName);
        _makati = db.Branches.Single(b => b.IsMain).Id;
        db.Branches.Add(new Branch { Id = _cebu, TenantId = Tenant, Name = "Cebu", Code = "CEB", TimeZone = "Asia/Manila", IsActive = true, CreatedAt = DateTime.UtcNow });
        db.Users.AddRange(
            NewUser(_manager, "ana.manager", UserRoleEnum.Admin, BranchScopeEnum.Selected),
            NewUser(_cebuCashier, "ben.cebu", UserRoleEnum.Cashier, BranchScopeEnum.Selected),
            NewUser(_makatiCashier, "cara.makati", UserRoleEnum.Cashier, BranchScopeEnum.Selected),
            NewUser(_owner, "owner", UserRoleEnum.Owner, BranchScopeEnum.All));
        db.UserBranches.AddRange(
            new UserBranch { UserId = _manager, BranchId = _cebu, TenantId = Tenant, CreatedAt = DateTime.UtcNow },
            new UserBranch { UserId = _cebuCashier, BranchId = _cebu, TenantId = Tenant, CreatedAt = DateTime.UtcNow },
            new UserBranch { UserId = _makatiCashier, BranchId = _makati, TenantId = Tenant, CreatedAt = DateTime.UtcNow });
        db.SaveChanges();
    }

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
        CreatedBy = id,
    };

    private WTFDbContext Limited() => TestDb.Create(_dbName, new FixedTenant(Tenant), new FixedBranch([_cebu], _cebu, true));

    private WTFDbContext Unlimited() => TestDb.Create(_dbName, new FixedTenant(Tenant), new FixedBranch([_makati, _cebu], _makati, false));

    private static Microsoft.AspNetCore.Http.IHttpContextAccessor AsManager(Guid id) => TestRequest.As(id, AppRoles.Admin);

    [Fact]
    public async Task ALimitedManager_ListsOnlyThePeopleOfTheirBranches()
    {
        await using var db = Limited();

        var list = await new GetUsersHandler(db, AsManager(_manager)).Handle(new GetUsersQuery(), CancellationToken.None);
        var paged = await new GetPagedUsersHandler(db, AsManager(_manager)).Handle(new GetPagedUsersQuery(), CancellationToken.None);

        list.Select(u => u.Username).Order().ShouldBe(["ana.manager", "ben.cebu"]);
        paged.Items.Select(u => u.Username).Order().ShouldBe(["ana.manager", "ben.cebu"]);
    }

    [Fact]
    public async Task ALimitedManager_CannotReadEditOrRemoveAPersonOfAnotherBranchOrAnAllScopeUser()
    {
        await using var db = Limited();
        var accessor = AsManager(_manager);

        foreach (var hidden in new[] { _makatiCashier, _owner })
        {
            (await new GetUserByIdHandler(db, accessor).Handle(new GetUserByIdQuery(hidden), CancellationToken.None)).ShouldBeNull();
            (await new UpdateUserHandler(db, accessor, TestFakes.Audit(), new RolePermissionCache(TimeProvider.System))
                .Handle(new UpdateUserCommand(hidden, "X", "Y", "hacked", "Newpass-123", (int)UserRoleEnum.Cashier), CancellationToken.None)).ShouldBeNull();
            (await new DeleteUserHandler(db, accessor, TestFakes.Audit(), new RolePermissionCache(TimeProvider.System))
                .Handle(new DeleteUserCommand(hidden), CancellationToken.None)).ShouldBeFalse();
        }

        (await new GetUserByIdHandler(db, accessor).Handle(new GetUserByIdQuery(_cebuCashier), CancellationToken.None)).ShouldNotBeNull();
        await using var check = TestDb.Create(_dbName);
        (await check.Users.SingleAsync(u => u.Id == _makatiCashier)).IsActive.ShouldBeTrue();
    }

    [Fact]
    public async Task APersonWhoSeesEveryBranch_ListsEveryone()
    {
        await using var db = Unlimited();

        var list = await new GetUsersHandler(db, AsManager(_owner)).Handle(new GetUsersQuery(), CancellationToken.None);

        list.Count.ShouldBe(4);
    }

    [Fact]
    public async Task ALimitedManager_CreatesPeopleLimitedToTheirOwnBranch_WhateverTheRole()
    {
        await using var db = Limited();
        var accessor = AsManager(_manager);
        var handler = new CreateUserHandler(db, accessor, TestFakes.Audit(), new RolePermissionCache(TimeProvider.System), new FixedTenant(Tenant), new FixedBranch([_cebu], _cebu, true));

        var created = await handler.Handle(new CreateUserCommand("Dina", "Lopez", "dina.lopez", "Strong-pass-1", (int)UserRoleEnum.Admin), CancellationToken.None);

        await using var check = TestDb.Create(_dbName);
        var user = await check.Users.SingleAsync(u => u.Id == created.Id);
        user.BranchScope.ShouldBe((byte)BranchScopeEnum.Selected);
        (await check.UserBranches.Where(u => u.UserId == user.Id).Select(u => u.BranchId).ToListAsync()).ShouldBe([_cebu]);
    }

    [Theory]
    [InlineData(UserRoleEnum.Kitchen)]
    [InlineData(UserRoleEnum.Cashier)]
    [InlineData(UserRoleEnum.StockManager)]
    public async Task APersonAddedInOneBranchAsKitchenCashierOrStockManager_IsLimitedToIt(UserRoleEnum role)
    {
        await using var db = Unlimited();
        var handler = new CreateUserHandler(db, AsManager(_owner), TestFakes.Audit(), new RolePermissionCache(TimeProvider.System), new FixedTenant(Tenant), new FixedBranch([_makati, _cebu], _cebu, false));

        var created = await handler.Handle(new CreateUserCommand("Eli", "Tan", "eli.tan", "Strong-pass-1", (int)role), CancellationToken.None);

        await using var check = TestDb.Create(_dbName);
        (await check.Users.SingleAsync(u => u.Id == created.Id)).BranchScope.ShouldBe((byte)BranchScopeEnum.Selected);
    }

    [Fact]
    public async Task MovingAnAllScopeAdminToCashier_LimitsThemToABranch()
    {
        var admin = Guid.NewGuid();
        await TestDb.SaveAsync(_dbName, NewUser(admin, "gio.admin", UserRoleEnum.Admin, BranchScopeEnum.All));
        await using var db = Unlimited();
        var handler = new UpdateUserHandler(db, AsManager(_owner), TestFakes.Audit(), new RolePermissionCache(TimeProvider.System));

        await handler.Handle(new UpdateUserCommand(admin, "gio.admin", "Reyes", "gio.admin", null, (int)UserRoleEnum.Cashier), CancellationToken.None);

        await using var check = TestDb.Create(_dbName);
        var user = await check.Users.SingleAsync(u => u.Id == admin);
        user.BranchScope.ShouldBe((byte)BranchScopeEnum.Selected);
        (await check.UserBranches.Where(u => u.UserId == admin).Select(u => u.BranchId).ToListAsync()).ShouldBe([_makati]);
    }
}
