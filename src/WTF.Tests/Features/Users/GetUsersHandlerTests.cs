using Microsoft.AspNetCore.Http;
using WTF.Api.Features.Users;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Users;

public class GetUsersHandlerTests
{
    private readonly string _dbName = TestDb.NewName();

    private async Task Seed()
    {
        await using var db = TestDb.Create(_dbName);
        db.UserRoles.Add(new UserRole { Id = 2, Name = "Cashier" });
        db.Users.Add(U("Zed", "Alpha", "zalpha", true));
        db.Users.Add(U("Ana", "Cruz", "acruz", true));
        db.Users.Add(U("Bob", "Cruz", "bobby", false));
        db.Users.Add(U("Cy", "Young", "cyy", true));
        await db.SaveChangesAsync();
    }

    private static User U(string first, string last, string username, bool active) => new()
    {
        Id = Guid.NewGuid(),
        Username = username,
        FirstName = first,
        LastName = last,
        PasswordHash = "h",
        IsActive = active,
        RoleId = 2,
        CreatedAt = DateTime.UtcNow
    };

    private GetUsersHandler Handler()
    {
        var accessor = TestRequest.As(Guid.NewGuid());
        accessor.HttpContext!.Request.Scheme = "https";
        accessor.HttpContext.Request.Host = new HostString("api.test");
        return new GetUsersHandler(TestDb.Create(_dbName), accessor);
    }

    [Fact]
    public async Task Handle_NoFilters_ReturnsAllOrderedByLastThenFirstName()
    {
        await Seed();

        var users = await Handler().Handle(new GetUsersQuery(), CancellationToken.None);

        users.Select(u => u.Username).ShouldBe(["zalpha", "acruz", "bobby", "cyy"]);
    }

    [Theory]
    [InlineData(true, 3)]
    [InlineData(false, 1)]
    public async Task Handle_IsActiveFilter_ReturnsOnlyMatching(bool isActive, int expected)
    {
        await Seed();

        var users = await Handler().Handle(new GetUsersQuery { IsActive = isActive }, CancellationToken.None);

        users.Count.ShouldBe(expected);
        users.ShouldAllBe(u => u.IsActive == isActive);
    }

    [Theory]
    [InlineData("cruz", 2)]
    [InlineData("CRUZ", 2)]
    [InlineData("ana", 1)]
    [InlineData("bob", 1)]
    [InlineData("nomatch", 0)]
    public async Task Handle_SearchTerm_MatchesNamesAndUsernameIgnoringCase(string term, int expected)
    {
        await Seed();

        var users = await Handler().Handle(new GetUsersQuery { SearchTerm = term }, CancellationToken.None);

        users.Count.ShouldBe(expected);
    }

    [Fact]
    public async Task Handle_SearchAndActiveFilter_AreCombined()
    {
        await Seed();

        var users = await Handler().Handle(new GetUsersQuery { SearchTerm = "cruz", IsActive = true }, CancellationToken.None);

        users.Select(u => u.Username).ShouldBe(["acruz"]);
    }

    [Fact]
    public async Task Handle_BlankSearchTerm_IsIgnored()
    {
        await Seed();

        var users = await Handler().Handle(new GetUsersQuery { SearchTerm = "  " }, CancellationToken.None);

        users.Count.ShouldBe(4);
    }

    [Fact]
    public async Task Handle_UserWithImage_ReturnsAbsoluteUrl()
    {
        await Seed();
        await using (var db = TestDb.Create(_dbName))
        {
            var target = db.Users.First(u => u.Username == "acruz");
            var imageId = Guid.NewGuid();
            db.Images.Add(new Image { ImageId = imageId, ImageUrl = "/images/users/a.png", UploadedAt = DateTime.UtcNow });
            db.UserImages.Add(new UserImage { UserId = target.Id, ImageId = imageId });
            await db.SaveChangesAsync();
        }

        var users = await Handler().Handle(new GetUsersQuery(), CancellationToken.None);

        users.Single(u => u.Username == "acruz").ImageUrl.ShouldBe("https://api.test/images/users/a.png");
        users.Single(u => u.Username == "cyy").ImageUrl.ShouldBeNull();
    }

    // Real-database version: Database/UserDatabaseTests.cs
}
