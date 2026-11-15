using Microsoft.AspNetCore.Http;
using WTF.Api.Features.Users;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Users;

public class GetPagedUsersHandlerTests
{
    private readonly string _dbName = TestDb.NewName();

    private async Task SeedAsync(int cashiers, int admins = 0, int inactiveCashiers = 0)
    {
        await using var db = TestDb.Create(_dbName);
        db.UserRoles.Add(new UserRole { Id = 1, Name = "Admin" });
        db.UserRoles.Add(new UserRole { Id = 2, Name = "Cashier" });
        for (var i = 0; i < cashiers; i++)
        {
            db.Users.Add(U($"Cash{i:000}", "Same", $"cash{i:000}", true, 2));
        }

        for (var i = 0; i < admins; i++)
        {
            db.Users.Add(U($"Adm{i:000}", "Same", $"adm{i:000}", true, 1));
        }

        for (var i = 0; i < inactiveCashiers; i++)
        {
            db.Users.Add(U($"Gone{i:000}", "Same", $"gone{i:000}", false, 2));
        }

        await db.SaveChangesAsync();
    }

    private static User U(string first, string last, string username, bool active, int roleId) => new()
    {
        Id = Guid.NewGuid(),
        Username = username,
        FirstName = first,
        LastName = last,
        PasswordHash = "h",
        IsActive = active,
        RoleId = roleId,
        CreatedAt = DateTime.UtcNow
    };

    private GetPagedUsersHandler Handler()
    {
        var accessor = TestRequest.As(Guid.NewGuid());
        accessor.HttpContext!.Request.Scheme = "https";
        accessor.HttpContext.Request.Host = new HostString("api.test");
        return new GetPagedUsersHandler(TestDb.Create(_dbName), accessor);
    }

    [Fact]
    public async Task Handle_PagesAndNeverRepeatsAUser()
    {
        await SeedAsync(27);

        var first = await Handler().Handle(new GetPagedUsersQuery(), CancellationToken.None);
        var second = await Handler().Handle(new GetPagedUsersQuery(Page: 2), CancellationToken.None);

        first.TotalCount.ShouldBe(27);
        first.Items.Count.ShouldBe(25);
        second.Items.Count.ShouldBe(2);
        first.Items.Select(u => u.Id).Intersect(second.Items.Select(u => u.Id)).ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_PageAfterTheLast_ReturnsTheLastPage()
    {
        await SeedAsync(30);

        var result = await Handler().Handle(new GetPagedUsersQuery(Page: 7), CancellationToken.None);

        result.Page.ShouldBe(2);
        result.Items.Count.ShouldBe(5);
    }

    [Fact]
    public async Task Handle_RoleAndStatusFilters_AndEachChipGroupIgnoresItsOwnFilter()
    {
        await SeedAsync(cashiers: 4, admins: 2, inactiveCashiers: 3);

        var result = await Handler().Handle(
            new GetPagedUsersQuery(IsActive: true, RoleIds: [2]), CancellationToken.None);

        result.TotalCount.ShouldBe(4);
        result.Facets!["active"].ShouldBe(4);
        result.Facets["inactive"].ShouldBe(3);
        result.Facets["role:2"].ShouldBe(4);
        result.Facets["role:1"].ShouldBe(2);
    }

    [Fact]
    public async Task Handle_Search_MatchesNameAndUsername_AndFacetsFollowIt()
    {
        await SeedAsync(cashiers: 3, admins: 1);

        var byUsername = await Handler().Handle(new GetPagedUsersQuery(SearchTerm: "adm000"), CancellationToken.None);
        var byFullName = await Handler().Handle(new GetPagedUsersQuery(SearchTerm: "cash001 same"), CancellationToken.None);

        byUsername.TotalCount.ShouldBe(1);
        byUsername.Facets!["active"].ShouldBe(1);
        byFullName.Items.Single().Username.ShouldBe("cash001");
    }

    [Fact]
    public async Task Handle_SortsByNameOrRole_AndIgnoresUnknownColumns()
    {
        await SeedAsync(cashiers: 2, admins: 2);

        var nameDesc = await Handler().Handle(new GetPagedUsersQuery(SortBy: "name", SortDirection: "desc"), CancellationToken.None);
        var roleAsc = await Handler().Handle(new GetPagedUsersQuery(SortBy: "role", SortDirection: "asc"), CancellationToken.None);
        var unknown = await Handler().Handle(new GetPagedUsersQuery(SortBy: "x; drop table"), CancellationToken.None);

        nameDesc.Items.First().FirstName.ShouldBe("Cash001");
        roleAsc.Items.Take(2).ShouldAllBe(u => u.RoleId == 1);
        unknown.Items.First().FirstName.ShouldBe("Adm000");
    }
}
