using WTF.Api.Features.Customers;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Customers;

public class GetPagedCustomersHandlerTests
{
    private readonly string _dbName = TestDb.NewName();

    private GetPagedCustomersHandler Handler() => new(TestDb.Create(_dbName), TestRequest.None());

    private Task SeedManyAsync(int active, int inactive = 0)
    {
        var customers = new List<object>();
        for (var i = 0; i < active; i++)
        {
            customers.Add(CustomerSeed.NewCustomer($"Cust{i:000}", "Same"));
        }

        for (var i = 0; i < inactive; i++)
        {
            customers.Add(CustomerSeed.NewCustomer($"Gone{i:000}", "Same", isActive: false));
        }

        return CustomerSeed.SeedAsync(_dbName, [.. customers]);
    }

    [Fact]
    public async Task Handle_PagesTheListAndReportsTheTotal()
    {
        await SeedManyAsync(55);

        var second = await Handler().Handle(new GetPagedCustomersQuery(Page: 2), CancellationToken.None);
        var last = await Handler().Handle(new GetPagedCustomersQuery(Page: 3), CancellationToken.None);

        second.TotalCount.ShouldBe(55);
        second.Items.Count.ShouldBe(25);
        second.Items[0].FirstName.ShouldBe("Cust025");
        last.Items.Count.ShouldBe(5);
        last.Items.Select(c => c.Id).Intersect(second.Items.Select(c => c.Id)).ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_PageAfterTheLast_ReturnsTheLastPage()
    {
        await SeedManyAsync(30);

        var result = await Handler().Handle(new GetPagedCustomersQuery(Page: 9), CancellationToken.None);

        result.Page.ShouldBe(2);
        result.Items.Count.ShouldBe(5);
    }

    [Fact]
    public async Task Handle_StatusFilterAndFacets_CountEachStatusIgnoringTheStatusFilter()
    {
        await SeedManyAsync(4, 3);

        var inactive = await Handler().Handle(new GetPagedCustomersQuery(IsActive: false), CancellationToken.None);

        inactive.TotalCount.ShouldBe(3);
        inactive.Facets!["active"].ShouldBe(4);
        inactive.Facets["inactive"].ShouldBe(3);
    }

    [Fact]
    public async Task Handle_SearchMatchesNameAddressAndContactDigits_AndFacetsFollowIt()
    {
        var withPhone = CustomerSeed.NewCustomer("Maria", "Santos", address: "12 Rizal St");
        withPhone.ContactNumber = "0917 123 4567";
        await CustomerSeed.SeedAsync(_dbName, withPhone, CustomerSeed.NewCustomer("Pedro", "Reyes", address: "Elsewhere"));

        var byName = await Handler().Handle(new GetPagedCustomersQuery(SearchTerm: "maria santos"), CancellationToken.None);
        var byAddress = await Handler().Handle(new GetPagedCustomersQuery(SearchTerm: "rizal"), CancellationToken.None);
        var byPhone = await Handler().Handle(new GetPagedCustomersQuery(SearchTerm: "0917123"), CancellationToken.None);

        byName.TotalCount.ShouldBe(1);
        byAddress.TotalCount.ShouldBe(1);
        byPhone.Items.Single().FirstName.ShouldBe("Maria");
        byPhone.Facets!["active"].ShouldBe(1);
    }

    [Fact]
    public async Task Handle_SortsByNameOrAddress_ThenFallsBackOnUnknownColumns()
    {
        await CustomerSeed.SeedAsync(_dbName,
            CustomerSeed.NewCustomer("Bea", "X", address: "Zone 1"),
            CustomerSeed.NewCustomer("Abe", "X", address: "Zone 9"),
            CustomerSeed.NewCustomer("Cal", "X", address: "Zone 5"));

        var nameDesc = await Handler().Handle(new GetPagedCustomersQuery(SortBy: "name", SortDirection: "desc"), CancellationToken.None);
        var addressAsc = await Handler().Handle(new GetPagedCustomersQuery(SortBy: "address", SortDirection: "asc"), CancellationToken.None);
        var unknown = await Handler().Handle(new GetPagedCustomersQuery(SortBy: "x; drop table"), CancellationToken.None);

        nameDesc.Items.Select(c => c.FirstName).ShouldBe(["Cal", "Bea", "Abe"]);
        addressAsc.Items.Select(c => c.FirstName).ShouldBe(["Bea", "Cal", "Abe"]);
        unknown.Items.Select(c => c.FirstName).ShouldBe(["Abe", "Bea", "Cal"]);
    }
}
