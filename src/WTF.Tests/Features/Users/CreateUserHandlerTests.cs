using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Users;
using WTF.Api.Features.Users.Enums;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Users;

public class CreateUserHandlerTests
{
    private readonly string _dbName = TestDb.NewName();
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly Guid _actorId = Guid.NewGuid();

    private CreateUserHandler Handler() => new(TestDb.Create(_dbName), TestRequest.As(_actorId), _audit);

    [Fact]
    public async Task Handle_ValidUser_IsSavedActiveWithHashedPassword()
    {
        var dto = await Handler().Handle(new CreateUserCommand("Ana", "Cruz", "acruz", "pw-12345", UserRoleEnum.Cashier), CancellationToken.None);

        dto.Username.ShouldBe("acruz");
        dto.IsActive.ShouldBeTrue();
        dto.RoleId.ShouldBe(UserRoleEnum.Cashier);
        dto.CreatedBy.ShouldBe(_actorId);
        dto.ImageUrl.ShouldBeNull();

        await using var db = TestDb.Create(_dbName);
        var saved = await db.Users.SingleAsync();
        saved.Id.ShouldBe(dto.Id);
        saved.RoleId.ShouldBe((int)UserRoleEnum.Cashier);
        saved.PasswordHash.ShouldNotBe("pw-12345");
        BCrypt.Net.BCrypt.Verify("pw-12345", saved.PasswordHash).ShouldBeTrue();
        saved.CreatedBy.ShouldBe(_actorId);
    }

    [Theory]
    [InlineData(UserRoleEnum.Admin, 1)]
    [InlineData(UserRoleEnum.Cashier, 2)]
    [InlineData(UserRoleEnum.AdminViewer, 3)]
    [InlineData(UserRoleEnum.SuperAdmin, 4)]
    [InlineData(UserRoleEnum.ItemManager, 5)]
    [InlineData(UserRoleEnum.StockManager, 6)]
    public async Task Handle_Role_IsMappedToRoleId(UserRoleEnum role, int expectedId)
    {
        await Handler().Handle(new CreateUserCommand("A", "B", "user", "pw", role), CancellationToken.None);

        await using var db = TestDb.Create(_dbName);
        (await db.Users.SingleAsync()).RoleId.ShouldBe(expectedId);
    }

    [Fact]
    public async Task Handle_ValidUser_AuditsWithoutPasswordHash()
    {
        var dto = await Handler().Handle(new CreateUserCommand("Ana", "Cruz", "acruz", "pw-12345", UserRoleEnum.Admin), CancellationToken.None);

        await _audit.Received(1).LogAsync(
            AuditAction.UserCreated, AuditEntityType.User, dto.Id.ToString(),
            Arg.Any<object?>(),
            Arg.Is<object?>(o => o != null && o.ToString()!.Contains("acruz") && !o.ToString()!.Contains("PasswordHash") && !o.ToString()!.Contains("pw-12345")),
            _actorId, Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Handle_BlankUsername_ThrowsAndSavesNothing(string username)
    {
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(new CreateUserCommand("A", "B", username, "pw", UserRoleEnum.Admin), CancellationToken.None));

        await using var db = TestDb.Create(_dbName);
        (await db.Users.CountAsync()).ShouldBe(0);
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Theory]
    [InlineData("")]
    [InlineData("  ")]
    public async Task Handle_BlankPassword_ThrowsAndSavesNothing(string password)
    {
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(new CreateUserCommand("A", "B", "user", password, UserRoleEnum.Admin), CancellationToken.None));

        await using var db = TestDb.Create(_dbName);
        (await db.Users.CountAsync()).ShouldBe(0);
    }

    // Real-database version: Database/UserDatabaseTests.cs
}
