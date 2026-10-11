using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Services;

public class UserRoleServiceTests
{
    private readonly string _dbName = TestDb.NewName();

    private static User U(Guid id, int roleId) => new()
    {
        Id = id, Username = id.ToString("N"), FirstName = "F", LastName = "L", PasswordHash = "h",
        IsActive = true, RoleId = roleId, CreatedAt = DateTime.UtcNow
    };

    [Fact]
    public async Task GetRoleNameAsync_UserWithRole_ReturnsRoleName()
    {
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();
        await using (var db = TestDb.Create(_dbName))
        {
            db.UserRoles.Add(new UserRole { Id = 1, Name = "Admin" });
            db.UserRoles.Add(new UserRole { Id = 2, Name = "Cashier" });
            db.Users.Add(U(a, 1));
            db.Users.Add(U(b, 2));
            await db.SaveChangesAsync();
        }

        var service = new UserRoleService(TestDb.Create(_dbName));

        (await service.GetRoleNameAsync(a, CancellationToken.None)).ShouldBe("Admin");
        (await service.GetRoleNameAsync(b, CancellationToken.None)).ShouldBe("Cashier");
    }

    [Fact]
    public async Task GetRoleNameAsync_UnknownUser_Throws()
    {
        var service = new UserRoleService(TestDb.Create(_dbName));

        var id = Guid.NewGuid();
        var ex = await Should.ThrowAsync<InvalidOperationException>(() => service.GetRoleNameAsync(id, CancellationToken.None));
        ex.Message.ShouldContain(id.ToString());
    }

    [Fact]
    public async Task GetRoleNameAsync_UserWithoutMatchingRole_Throws()
    {
        var id = Guid.NewGuid();
        await using (var db = TestDb.Create(_dbName))
        {
            db.Users.Add(U(id, 99));
            await db.SaveChangesAsync();
        }

        var service = new UserRoleService(TestDb.Create(_dbName));

        await Should.ThrowAsync<InvalidOperationException>(() => service.GetRoleNameAsync(id, CancellationToken.None));
    }

    [Fact]
    public async Task GetRoleNameAsync_BlankRoleName_Throws()
    {
        var id = Guid.NewGuid();
        await using (var db = TestDb.Create(_dbName))
        {
            db.UserRoles.Add(new UserRole { Id = 1, Name = "  " });
            db.Users.Add(U(id, 1));
            await db.SaveChangesAsync();
        }

        var service = new UserRoleService(TestDb.Create(_dbName));

        await Should.ThrowAsync<InvalidOperationException>(() => service.GetRoleNameAsync(id, CancellationToken.None));
    }
}
