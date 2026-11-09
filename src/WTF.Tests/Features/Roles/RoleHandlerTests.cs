using Microsoft.EntityFrameworkCore;
using NSubstitute;
using System.Text.Json;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Roles;
using WTF.Api.Features.Users;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Roles;

public class RoleHandlerTests
{
    private static readonly Guid ShopA = Guid.Parse("00000000-0000-0000-0000-00000000000a");
    private static readonly Guid ShopB = Guid.Parse("00000000-0000-0000-0000-00000000000b");

    private readonly string _dbName = TestDb.NewName();
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly RolePermissionCache _cache = new(TimeProvider.System);
    private readonly Guid _actorId = Guid.NewGuid();

    public RoleHandlerTests() => TestDb.SeedSystemRoles(_dbName);

    private WTFDbContext Db(Guid? shop = null) => TestDb.Create(_dbName, new FixedTenant(shop ?? ShopA));

    private CreateRoleHandler Create(string actorRole = AppRoles.Owner, Guid? shop = null) =>
        new(Db(shop), TestRequest.As(_actorId, actorRole), _audit, _cache);

    private UpdateRoleHandler Update(string actorRole = AppRoles.Owner, Guid? shop = null) =>
        new(Db(shop), TestRequest.As(_actorId, actorRole), _audit, _cache);

    private DeleteRoleHandler Delete(string actorRole = AppRoles.Owner, Guid? shop = null) =>
        new(Db(shop), TestRequest.As(_actorId, actorRole), _audit, _cache);

    private DuplicateRoleHandler Duplicate(string actorRole = AppRoles.Owner, Guid? shop = null) =>
        new(Db(shop), TestRequest.As(_actorId, actorRole), _audit, _cache);

    private async Task<int> CreateRoleAsync(string name, string[] permissions, string actorRole = AppRoles.Owner, Guid? shop = null) =>
        (await Create(actorRole, shop).Handle(new CreateRoleCommand(name, null, [.. permissions]), CancellationToken.None)).Id;

    [Fact]
    public async Task Create_SavesTheRoleForTheShopWithWhatItsKeysRequire()
    {
        var detail = await Create().Handle(new CreateRoleCommand("  Shift Lead ", "Runs the floor", ["orders.write", "stock.write"]), CancellationToken.None);

        detail.Name.ShouldBe("Shift Lead");
        detail.IsSystem.ShouldBeFalse();
        detail.Permissions.ShouldBe(["orders.read", "orders.write", "stock.read", "stock.write"]);

        await using var db = Db();
        var saved = await db.UserRoles.SingleAsync(r => r.Id == detail.Id);
        saved.TenantId.ShouldBe(ShopA);
        saved.Description.ShouldBe("Runs the floor");
        saved.Id.ShouldBeGreaterThanOrEqualTo(RoleRulesFirstId);
        (await db.RolePermissions.Where(p => p.RoleId == detail.Id).CountAsync()).ShouldBe(4);

        await _audit.Received(1).LogAsync(AuditAction.RoleCreated, AuditEntityType.Role, detail.Id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), Arg.Any<Guid?>(), Arg.Any<CancellationToken>());
    }

    private const int RoleRulesFirstId = 100;

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("Owner")]
    [InlineData("admin")]
    [InlineData("SuperAdmin")]
    [InlineData("PlatformAdmin")]
    public async Task Create_EmptyOrReservedName_IsRefused(string name)
    {
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(new CreateRoleCommand(name, null, ["orders.read"]), CancellationToken.None));
    }

    [Fact]
    public async Task Create_NameTakenInTheSameShop_IsRefusedIgnoringCase_ButFreeInAnotherShop()
    {
        await CreateRoleAsync("Barista", ["orders.read"]);

        await Should.ThrowAsync<InvalidOperationException>(() => CreateRoleAsync("barista", ["orders.read"]));
        (await CreateRoleAsync("Barista", ["orders.read"], shop: ShopB)).ShouldBeGreaterThan(0);
    }

    [Fact]
    public async Task Create_UnknownPermission_IsRefused()
    {
        var error = await Should.ThrowAsync<InvalidOperationException>(() => CreateRoleAsync("Odd", ["orders.read", "made.up"]));

        error.Message.ShouldContain("made.up");
    }

    [Fact]
    public async Task Create_WithAPermissionTheActorLacks_IsForbidden()
    {
        // Admin does not hold audit.read or roles.manage.
        await Should.ThrowAsync<ForbiddenActionException>(() => CreateRoleAsync("Sneaky", ["audit.read"], AppRoles.Admin));
        await Should.ThrowAsync<ForbiddenActionException>(() => CreateRoleAsync("Sneakier", ["roles.manage"], AppRoles.Admin));
        (await CreateRoleAsync("Fine", ["orders.read", "expenses.write"], AppRoles.Admin)).ShouldBeGreaterThan(0);
    }

    [Fact]
    public async Task Update_ChangesNameAndKeys_AndRecordsWhatWasAddedAndRemoved()
    {
        var id = await CreateRoleAsync("Counter", ["orders.write"]);

        var detail = await Update().Handle(new UpdateRoleCommand(id, "Counter Staff", "Front", ["orders.read", "expenses.write"]), CancellationToken.None);

        detail!.Name.ShouldBe("Counter Staff");
        detail.Permissions.ShouldBe(["expenses.read", "expenses.write", "orders.read"]);
        await using var db = Db();
        (await db.RolePermissions.Where(p => p.RoleId == id).Select(p => p.PermissionKey).ToListAsync()).Order()
            .ShouldBe(["expenses.read", "expenses.write", "orders.read"]);

        var update = _audit.ReceivedCalls().Single(c => c.GetArguments()[0] is AuditAction.RoleUpdated);
        var recorded = JsonSerializer.Serialize(update.GetArguments()[4]);
        recorded.ShouldContain("\"Added\":[\"expenses.read\",\"expenses.write\"]");
        recorded.ShouldContain("\"Removed\":[\"orders.write\"]");
    }

    [Fact]
    public async Task Update_BuiltInRole_IsRefused()
    {
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Update().Handle(new UpdateRoleCommand((int)WTF.Api.Features.Users.Enums.UserRoleEnum.Cashier, "Cashier", null, ["orders.read"]), CancellationToken.None));
    }

    [Fact]
    public async Task Update_AnotherShopsRole_IsNotFound()
    {
        var id = await CreateRoleAsync("Private", ["orders.read"], shop: ShopB);

        var result = await Update(shop: ShopA).Handle(new UpdateRoleCommand(id, "Hijacked", null, ["orders.read"]), CancellationToken.None);

        result.ShouldBeNull();
    }

    [Fact]
    public async Task Update_ARoleCarryingPermissionsTheActorLacks_IsForbidden()
    {
        var id = await CreateRoleAsync("Auditor", ["audit.read"]);

        await Should.ThrowAsync<ForbiddenActionException>(() =>
            Update(AppRoles.Admin).Handle(new UpdateRoleCommand(id, "Auditor", null, ["orders.read"]), CancellationToken.None));
    }

    [Fact]
    public async Task Delete_UnusedRole_IsRemovedWithItsKeys()
    {
        var id = await CreateRoleAsync("Temp", ["orders.read"]);

        (await Delete().Handle(new DeleteRoleCommand(id), CancellationToken.None)).ShouldBeTrue();

        await using var db = Db();
        (await db.UserRoles.AnyAsync(r => r.Id == id)).ShouldBeFalse();
        (await db.RolePermissions.AnyAsync(p => p.RoleId == id)).ShouldBeFalse();
    }

    [Fact]
    public async Task Delete_RoleWithUsers_IsRefusedUntilTheyMove()
    {
        var id = await CreateRoleAsync("Busy", ["orders.read"]);
        await TestDb.SaveAsync(_dbName, new User
        {
            Id = Guid.NewGuid(),
            Username = "u",
            FirstName = "U",
            LastName = "U",
            PasswordHash = "x",
            IsActive = true,
            RoleId = id,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = _actorId,
            TenantId = ShopA,
        });

        var error = await Should.ThrowAsync<InvalidOperationException>(() => Delete().Handle(new DeleteRoleCommand(id), CancellationToken.None));

        error.Message.ShouldContain("1 user has this role");
    }

    [Fact]
    public async Task Delete_BuiltInRole_IsRefused()
    {
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Delete().Handle(new DeleteRoleCommand((int)WTF.Api.Features.Users.Enums.UserRoleEnum.Cashier), CancellationToken.None));
    }

    [Fact]
    public async Task Duplicate_CopiesTheKeysUnderANewFreeName()
    {
        var first = await Duplicate().Handle(new DuplicateRoleCommand((int)WTF.Api.Features.Users.Enums.UserRoleEnum.Cashier), CancellationToken.None);
        var second = await Duplicate().Handle(new DuplicateRoleCommand((int)WTF.Api.Features.Users.Enums.UserRoleEnum.Cashier), CancellationToken.None);

        first!.Name.ShouldBe("Cashier copy");
        second!.Name.ShouldBe("Cashier copy 2");
        first.IsSystem.ShouldBeFalse();
        first.Permissions.Order().ShouldBe(SystemRolePermissions.Bundles[AppRoles.Cashier].Order());
    }

    [Fact]
    public async Task Duplicate_OfARoleBeyondTheActor_IsForbidden()
    {
        await Should.ThrowAsync<ForbiddenActionException>(() =>
            Duplicate(AppRoles.Admin).Handle(new DuplicateRoleCommand((int)WTF.Api.Features.Users.Enums.UserRoleEnum.Owner), CancellationToken.None));
    }

    [Fact]
    public async Task GetRoles_ListsBuiltInRolesAndOnlyThisShopsCustomRoles()
    {
        await CreateRoleAsync("Mine", ["orders.read"]);
        await CreateRoleAsync("Theirs", ["orders.read"], shop: ShopB);

        await using var db = Db();
        var roles = await new GetRolesHandler(db).Handle(new GetRolesQuery(), CancellationToken.None);

        roles.Select(r => r.Name).ShouldContain("Mine");
        roles.Select(r => r.Name).ShouldNotContain("Theirs");
        roles.Count(r => r.IsSystem).ShouldBe(6);
        roles.Single(r => r.Name == "Mine").Permissions.ShouldBe(["orders.read"]);
        roles.Single(r => r.Name == "Owner").PermissionCount.ShouldBe(PermissionCatalog.All.Count);
    }

    [Fact]
    public async Task GetRoleById_OfAnotherShopsRole_IsNotFound()
    {
        var id = await CreateRoleAsync("Theirs", ["orders.read"], shop: ShopB);

        await using var db = Db(ShopA);
        (await new GetRoleByIdHandler(db).Handle(new GetRoleByIdQuery(id), CancellationToken.None)).ShouldBeNull();
    }

    [Fact]
    public async Task RoleEdit_TakesEffectOnTheNextLookup_AfterTheCacheIsCleared()
    {
        var roleId = await CreateRoleAsync("Floor", ["orders.read"]);
        var userId = Guid.NewGuid();
        await TestDb.SaveAsync(_dbName, new User
        {
            Id = userId,
            Username = "f",
            FirstName = "F",
            LastName = "F",
            PasswordHash = "x",
            IsActive = true,
            RoleId = roleId,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = _actorId,
            TenantId = ShopA,
        });

        await using (var db = Db())
        {
            (await _cache.GetAsync(db, userId, CancellationToken.None)).Keys.ShouldBe(["orders.read"]);
        }

        await Update().Handle(new UpdateRoleCommand(roleId, "Floor", null, ["orders.read", "expenses.read"]), CancellationToken.None);

        await using (var db = Db())
        {
            var access = await _cache.GetAsync(db, userId, CancellationToken.None);
            access.Keys.Order().ShouldBe(["expenses.read", "orders.read"]);
            access.RoleName.ShouldBe("Floor");
            access.IsSystemRole.ShouldBeFalse();
        }
    }

    [Fact]
    public async Task Access_OfASystemRole_ComesFromItsBundle_AndAnInactiveUserHasNone()
    {
        var cashier = Guid.NewGuid();
        var gone = Guid.NewGuid();
        await TestDb.SaveAsync(_dbName,
            new User { Id = cashier, Username = "c", FirstName = "C", LastName = "C", PasswordHash = "x", IsActive = true, RoleId = 2, CreatedAt = DateTime.UtcNow, CreatedBy = _actorId, TenantId = ShopA },
            new User { Id = gone, Username = "g", FirstName = "G", LastName = "G", PasswordHash = "x", IsActive = false, RoleId = 2, CreatedAt = DateTime.UtcNow, CreatedBy = _actorId, TenantId = ShopA });

        await using var db = Db();
        (await RolePermissionCache.LoadAsync(db, cashier, CancellationToken.None)).Keys.Order()
            .ShouldBe(SystemRolePermissions.Bundles[AppRoles.Cashier].Order());
        (await RolePermissionCache.LoadAsync(db, gone, CancellationToken.None)).Keys.ShouldBeEmpty();
    }

    [Fact]
    public async Task Users_CannotBeGivenARoleBeyondTheActor_OrChangeTheirOwnRole_OrLeaveTheShopWithoutAnOwner()
    {
        var admin = Guid.NewGuid();
        var owner = Guid.NewGuid();
        var worker = Guid.NewGuid();
        await TestDb.SaveAsync(_dbName,
            new User { Id = admin, Username = "a", FirstName = "A", LastName = "A", PasswordHash = "x", IsActive = true, RoleId = 1, CreatedAt = DateTime.UtcNow, CreatedBy = _actorId, TenantId = ShopA },
            new User { Id = owner, Username = "o", FirstName = "O", LastName = "O", PasswordHash = "x", IsActive = true, RoleId = 4, CreatedAt = DateTime.UtcNow, CreatedBy = _actorId, TenantId = ShopA },
            new User { Id = worker, Username = "w", FirstName = "W", LastName = "W", PasswordHash = "x", IsActive = true, RoleId = 2, CreatedAt = DateTime.UtcNow, CreatedBy = _actorId, TenantId = ShopA });
        var auditorRole = await CreateRoleAsync("Auditor", ["audit.read"]);

        UpdateUserHandler AsAdmin() => new(Db(), TestRequest.As(admin, AppRoles.Admin), _audit, _cache);
        UpdateUserHandler AsOwner() => new(Db(), TestRequest.As(owner, AppRoles.Owner), _audit, _cache);

        await Should.ThrowAsync<ForbiddenActionException>(() =>
            AsAdmin().Handle(new UpdateUserCommand(worker, "W", "W", "w", null, auditorRole), CancellationToken.None));
        await Should.ThrowAsync<ForbiddenActionException>(() =>
            AsAdmin().Handle(new UpdateUserCommand(admin, "A", "A", "a", null, 2), CancellationToken.None));
        await Should.ThrowAsync<InvalidOperationException>(() =>
            AsAdmin().Handle(new UpdateUserCommand(worker, "W", "W", "w", null, 999), CancellationToken.None));

        var moved = await AsOwner().Handle(new UpdateUserCommand(worker, "W", "W", "w", null, auditorRole), CancellationToken.None);
        moved!.RoleId.ShouldBe(auditorRole);
        moved.RoleName.ShouldBe("Auditor");

        var delete = new DeleteUserHandler(Db(), TestRequest.As(admin, AppRoles.Admin), _audit, _cache);
        await Should.ThrowAsync<InvalidOperationException>(() => delete.Handle(new DeleteUserCommand(owner), CancellationToken.None));
    }

    private sealed class FixedTenant(Guid id) : ICurrentTenant
    {
        public bool FilterEnabled => true;

        public Guid? TenantId => id;

        public Guid? StampTenantId => id;
    }
}
