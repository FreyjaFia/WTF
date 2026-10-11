using WTF.Api.Features.Customers;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Customers;

public class GetCustomersHandlerTests
{
    private readonly string _dbName = TestDb.NewName();

    private GetCustomersHandler Handler() => new(TestDb.Create(_dbName), TestRequest.None());

    [Fact]
    public async Task Handle_NoCustomers_ReturnsEmptyList()
    {
        var result = await Handler().Handle(new GetCustomersQuery(), CancellationToken.None);

        result.ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_DefaultQuery_ReturnsOnlyActiveOrderedByLastThenFirstName()
    {
        await CustomerSeed.SeedAsync(_dbName,
            CustomerSeed.NewCustomer("Zed", "Alvarez"),
            CustomerSeed.NewCustomer("Ana", "Cruz"),
            CustomerSeed.NewCustomer("Abe", "Cruz"),
            CustomerSeed.NewCustomer("Gone", "Aaron", isActive: false));

        var result = await Handler().Handle(new GetCustomersQuery(), CancellationToken.None);

        result.Select(c => $"{c.FirstName} {c.LastName}").ShouldBe(["Zed Alvarez", "Abe Cruz", "Ana Cruz"]);
    }

    [Fact]
    public async Task Handle_IsActiveNull_ReturnsActiveAndInactive()
    {
        await CustomerSeed.SeedAsync(_dbName,
            CustomerSeed.NewCustomer("A", "A"),
            CustomerSeed.NewCustomer("B", "B", isActive: false));

        var result = await Handler().Handle(new GetCustomersQuery { IsActive = null }, CancellationToken.None);

        result.Count.ShouldBe(2);
    }

    [Fact]
    public async Task Handle_IsActiveFalse_ReturnsOnlyInactive()
    {
        await CustomerSeed.SeedAsync(_dbName,
            CustomerSeed.NewCustomer("A", "A"),
            CustomerSeed.NewCustomer("B", "B", isActive: false));

        var result = await Handler().Handle(new GetCustomersQuery { IsActive = false }, CancellationToken.None);

        result.Select(c => c.FirstName).ShouldBe(["B"]);
    }

    [Theory]
    [InlineData("ana", "Ana")]
    [InlineData("CRUZ", "Ana")]
    [InlineData("makati", "Ben")]
    public async Task Handle_SearchTerm_MatchesFirstNameLastNameOrAddress(string term, string expectedFirstName)
    {
        await CustomerSeed.SeedAsync(_dbName,
            CustomerSeed.NewCustomer("Ana", "Cruz", "Manila"),
            CustomerSeed.NewCustomer("Ben", "Diaz", "Makati"));

        var result = await Handler().Handle(new GetCustomersQuery { SearchTerm = term }, CancellationToken.None);

        result.Select(c => c.FirstName).ShouldBe([expectedFirstName]);
    }

    [Fact]
    public async Task Handle_SearchTermMatchesNothing_ReturnsEmptyList()
    {
        await CustomerSeed.SeedAsync(_dbName, CustomerSeed.NewCustomer("Ana", "Cruz", null));

        var result = await Handler().Handle(new GetCustomersQuery { SearchTerm = "zzz" }, CancellationToken.None);

        result.ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_SearchCombinedWithInactiveFilter_AppliesBoth()
    {
        await CustomerSeed.SeedAsync(_dbName,
            CustomerSeed.NewCustomer("Ana", "Cruz"),
            CustomerSeed.NewCustomer("Ann", "Cole", isActive: false));

        var result = await Handler().Handle(new GetCustomersQuery { SearchTerm = "an", IsActive = false }, CancellationToken.None);

        result.Select(c => c.FirstName).ShouldBe(["Ann"]);
    }

    [Fact]
    public async Task Handle_CustomerWithImage_ReturnsImageUrl()
    {
        var customer = CustomerSeed.NewCustomer();
        var link = CustomerSeed.NewImage(customer.Id, "https://cdn.example/c.png", out var image);
        await CustomerSeed.SeedAsync(_dbName, customer, image, link);

        var result = await Handler().Handle(new GetCustomersQuery(), CancellationToken.None);

        result.ShouldHaveSingleItem().ImageUrl.ShouldBe("https://cdn.example/c.png");
    }

    // SQL translation of the search filter: see Database/CustomerDatabaseTests.cs.
}
