using Microsoft.AspNetCore.Http;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using WTF.Api.Features.Auth;
using WTF.Api.Features.Users;
using WTF.Api.Features.Users.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

/// <summary>User, login and user-search handlers against a real SQL Server: collation, unique index, foreign keys, SQL translation.</summary>
public class UserDatabaseTests
{
    private static IConfiguration Config() => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["Jwt:SecretKey"] = "unit-test-secret-key-that-is-long-enough-for-hmac-sha256",
        ["Jwt:Issuer"] = "wtf-tests",
        ["Jwt:Audience"] = "wtf-clients",
    }).Build();

    private static LoginHandler Login(WTFDbContext db)
    {
        var cfg = Config();
        return new LoginHandler(db, new JwtService(cfg, TestRequest.None()), new UserRoleService(db), cfg, TestFakes.Audit());
    }

    private static CreateUserHandler Create(WTFDbContext db, Guid actor) => new(db, TestRequest.As(actor), TestFakes.Audit());
    private static UpdateUserHandler Update(WTFDbContext db, Guid actor) => new(db, TestRequest.As(actor), TestFakes.Audit());

    private static GetUsersHandler Search(WTFDbContext db)
    {
        var accessor = TestRequest.As(Guid.NewGuid());
        accessor.HttpContext!.Request.Scheme = "https";
        accessor.HttpContext.Request.Host = new HostString("api.test");
        return new GetUsersHandler(db, accessor);
    }

    private static async Task SetPasswordAsync(SqlTestDatabase database, Guid id, string password)
    {
        await using var db = database.CreateContext();
        var row = await db.Users.SingleAsync(u => u.Id == id);
        row.PasswordHash = BCrypt.Net.BCrypt.HashPassword(password);
        await db.SaveChangesAsync();
    }

    // ---- Login ----

    [SqlFact]
    public async Task Login_UsernameDifferentCase_StillMatchesUnderSqlServerCollation()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database, "alem");
        await SetPasswordAsync(database, user.Id, "S3cret-pass");

        await using var db = database.CreateContext();
        var result = await Login(db).Handle(new LoginCommand("ALEM", "S3cret-pass"), CancellationToken.None);

        result.ShouldNotBeNull();
        result.AccessToken.ShouldNotBeNullOrEmpty();
    }

    [SqlFact]
    public async Task Login_SoftDeletedUser_IsRejected()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database, "alem", active: false);
        await SetPasswordAsync(database, user.Id, "S3cret-pass");

        await using var db = database.CreateContext();
        var result = await Login(db).Handle(new LoginCommand("alem", "S3cret-pass"), CancellationToken.None);

        result.ShouldBeNull();
    }

    // ---- Create ----

    // The handlers check for duplicates themselves (UserValidation.EnsureUniqueUsernameAsync): case-insensitive,
    // and deactivated users keep their name reserved. UX_Users_Username is the backstop for racing requests.
    [SqlFact]
    public async Task UsersTable_UniqueIndexOnUsername_RejectsADuplicateEvenWhenTheHandlerCheckIsSkipped()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SqlSeed.UserAsync(database, "taken");

        await Should.ThrowAsync<DbUpdateException>(() => SqlSeed.UserAsync(database, "TAKEN"));

        await using var check = database.CreateContext();
        (await check.Users.CountAsync()).ShouldBe(1);
    }

    [SqlTheory]
    [InlineData("taken")]
    [InlineData("TAKEN")]
    [InlineData("  Taken  ")]
    public async Task Create_DuplicateUsername_IsRejectedWhateverTheCase(string username)
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var actor = await SqlSeed.UserAsync(database, "admin");
        await SqlSeed.UserAsync(database, "taken");

        await using (var db = database.CreateContext())
        {
            var ex = await Should.ThrowAsync<InvalidOperationException>(() => Create(db, actor.Id).Handle(
                new CreateUserCommand("A", "B", username, "pw-12345", UserRoleEnum.Cashier), CancellationToken.None));
            ex.Message.ShouldBe("Username already exists.");
        }

        await using var check = database.CreateContext();
        (await check.Users.CountAsync(u => u.Username == "taken")).ShouldBe(1);
        (await check.Users.CountAsync()).ShouldBe(2);
    }

    [SqlFact]
    public async Task Create_UsernameOfADeactivatedUser_IsStillRejected()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var actor = await SqlSeed.UserAsync(database, "admin");
        await SqlSeed.UserAsync(database, "gone", active: false);

        await using var db = database.CreateContext();
        await Should.ThrowAsync<InvalidOperationException>(() => Create(db, actor.Id).Handle(
            new CreateUserCommand("A", "B", "gone", "pw-12345", UserRoleEnum.Cashier), CancellationToken.None));
    }

    [SqlFact]
    public async Task Create_ValidUser_IsSavedWithTheRoleForeignKey()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var actor = await SqlSeed.UserAsync(database, "admin");

        await using (var db = database.CreateContext())
        {
            await Create(db, actor.Id).Handle(new CreateUserCommand("Ana", "Cruz", "acruz", "pw-12345", UserRoleEnum.Cashier), CancellationToken.None);
        }

        await using var check = database.CreateContext();
        var saved = await check.Users.Include(u => u.Role).SingleAsync(u => u.Username == "acruz");
        saved.Role!.Name.ShouldBe("Cashier");
        saved.CreatedBy.ShouldBe(actor.Id);
    }

    [SqlFact]
    public async Task Create_UnknownRoleId_IsRejectedByTheRoleForeignKey()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var actor = await SqlSeed.UserAsync(database, "admin");

        await using var db = database.CreateContext();
        var ex = await Should.ThrowAsync<DbUpdateException>(() =>
            Create(db, actor.Id).Handle(new CreateUserCommand("A", "B", "newbie", "pw-12345", (UserRoleEnum)99), CancellationToken.None));

        ex.InnerException.ShouldBeOfType<SqlException>().Number.ShouldBe(547);
    }

    // ---- Update ----

    [SqlFact]
    public async Task Update_RenameToAnotherUsersUsername_IsRejected()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var actor = await SqlSeed.UserAsync(database, "admin");
        await SqlSeed.UserAsync(database, "taken");
        var target = await SqlSeed.UserAsync(database, "mine");

        await using (var db = database.CreateContext())
        {
            var ex = await Should.ThrowAsync<InvalidOperationException>(() => Update(db, actor.Id).Handle(
                new UpdateUserCommand(target.Id, "A", "B", "TAKEN", null, UserRoleEnum.Cashier), CancellationToken.None));
            ex.Message.ShouldBe("Username already exists.");
        }

        await using var check = database.CreateContext();
        (await check.Users.SingleAsync(u => u.Id == target.Id)).Username.ShouldBe("mine");
    }

    [SqlFact]
    public async Task Update_KeepingTheOwnUsername_Succeeds()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var actor = await SqlSeed.UserAsync(database, "admin");
        var target = await SqlSeed.UserAsync(database, "mine");

        await using (var db = database.CreateContext())
        {
            await Update(db, actor.Id).Handle(new UpdateUserCommand(target.Id, "New", "Name", "mine", null, UserRoleEnum.Admin), CancellationToken.None);
        }

        await using var check = database.CreateContext();
        var saved = await check.Users.SingleAsync(u => u.Id == target.Id);
        saved.FirstName.ShouldBe("New");
        saved.UpdatedBy.ShouldBe(actor.Id);
    }

    [SqlFact]
    public async Task Update_UnknownRoleId_IsRejectedByTheRoleForeignKey()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var actor = await SqlSeed.UserAsync(database, "admin");
        var target = await SqlSeed.UserAsync(database, "mine");

        await using var db = database.CreateContext();
        var ex = await Should.ThrowAsync<DbUpdateException>(() =>
            Update(db, actor.Id).Handle(new UpdateUserCommand(target.Id, "A", "B", "mine", null, (UserRoleEnum)99), CancellationToken.None));
        ex.InnerException.ShouldBeOfType<SqlException>().Number.ShouldBe(547);
    }

    // ---- Search ----

    [SqlTheory]
    [InlineData("cru")]
    [InlineData("CRU")]
    [InlineData("acr")]
    public async Task GetUsers_SearchTerm_MatchesAnyPartIgnoringCase(string term)
    {
        // The search used Contains(string, StringComparison), which SQL Server cannot translate; it now runs in SQL.
        await using var database = await SqlTestDatabase.CreateAsync();
        await SqlSeed.UserAsync(database, "acruz");
        await SqlSeed.UserAsync(database, "ben");

        await using var db = database.CreateContext();
        var result = await Search(db).Handle(new GetUsersQuery { SearchTerm = term }, CancellationToken.None);

        result.Single().Username.ShouldBe("acruz");
    }

    [SqlFact]
    public async Task GetUsers_SearchTerm_TreatsLikeWildcardsAsLiteralText()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SqlSeed.UserAsync(database, "acruz");

        await using var db = database.CreateContext();
        (await Search(db).Handle(new GetUsersQuery { SearchTerm = "%" }, CancellationToken.None)).ShouldBeEmpty();
        await using var db2 = database.CreateContext();
        (await Search(db2).Handle(new GetUsersQuery { SearchTerm = "_" }, CancellationToken.None)).ShouldBeEmpty();
    }

    [SqlFact]
    public async Task GetUsers_ActiveFilter_IsAppliedInSql()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SqlSeed.UserAsync(database, "acruz");
        await SqlSeed.UserAsync(database, "gone", active: false);

        await using var db = database.CreateContext();
        (await Search(db).Handle(new GetUsersQuery(), CancellationToken.None)).Count.ShouldBe(2);

        await using var db2 = database.CreateContext();
        var active = await Search(db2).Handle(new GetUsersQuery { IsActive = true }, CancellationToken.None);
        active.Single().Username.ShouldBe("acruz");
    }
}
