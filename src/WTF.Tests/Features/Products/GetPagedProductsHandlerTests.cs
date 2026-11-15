using WTF.Api.Features.Products;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Products;

public class GetPagedProductsHandlerTests
{
    private readonly string _dbName = TestDb.NewName();

    private GetPagedProductsHandler Handler() => new(TestDb.Create(_dbName), TestRequest.None());

    private Task SeedManyAsync(int count, int inactive = 0)
    {
        var products = new List<object>();
        for (var i = 0; i < count; i++)
        {
            products.Add(ProductSeed.NewProduct(name: $"Prod{i:000}", code: $"P{i:000}", price: 10 + i));
        }

        for (var i = 0; i < inactive; i++)
        {
            products.Add(ProductSeed.NewProduct(name: $"Gone{i:000}", code: $"G{i:000}", isActive: false));
        }

        return ProductSeed.SeedAsync(_dbName, [.. products]);
    }

    [Fact]
    public async Task Handle_PagesTheListAndNeverRepeatsAProduct()
    {
        await SeedManyAsync(55);

        var first = await Handler().Handle(new GetPagedProductsQuery(), CancellationToken.None);
        var last = await Handler().Handle(new GetPagedProductsQuery(Page: 3), CancellationToken.None);

        first.TotalCount.ShouldBe(55);
        first.Items.Count.ShouldBe(25);
        first.Items[0].Name.ShouldBe("Prod000");
        last.Items.Count.ShouldBe(5);
        first.Items.Select(p => p.Id).Intersect(last.Items.Select(p => p.Id)).ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_PageAfterTheLast_ReturnsTheLastPage()
    {
        await SeedManyAsync(30);

        var result = await Handler().Handle(new GetPagedProductsQuery(Page: 8), CancellationToken.None);

        result.Page.ShouldBe(2);
        result.Items.Count.ShouldBe(5);
    }

    [Fact]
    public async Task Handle_StatusFilter_KeepsBothStatusCountsAndSearchNarrowsThem()
    {
        await SeedManyAsync(4, inactive: 3);

        var inactive = await Handler().Handle(new GetPagedProductsQuery(IsActive: false), CancellationToken.None);
        var searched = await Handler().Handle(new GetPagedProductsQuery(SearchTerm: "gone001"), CancellationToken.None);

        inactive.TotalCount.ShouldBe(3);
        inactive.Facets!["active"].ShouldBe(4);
        inactive.Facets["inactive"].ShouldBe(3);
        searched.TotalCount.ShouldBe(1);
        searched.Facets!["active"].ShouldBe(0);
        searched.Facets["inactive"].ShouldBe(1);
    }

    [Fact]
    public async Task Handle_SortsByPriceOrName_AndIgnoresUnknownColumns()
    {
        await SeedManyAsync(3);

        var priceDesc = await Handler().Handle(new GetPagedProductsQuery(SortBy: "price", SortDirection: "desc"), CancellationToken.None);
        var nameAsc = await Handler().Handle(new GetPagedProductsQuery(SortBy: "name", SortDirection: "asc"), CancellationToken.None);
        var unknown = await Handler().Handle(new GetPagedProductsQuery(SortBy: "x; drop table"), CancellationToken.None);

        priceDesc.Items.Select(p => p.Name).ShouldBe(["Prod002", "Prod001", "Prod000"]);
        nameAsc.Items.Select(p => p.Name).ShouldBe(["Prod000", "Prod001", "Prod002"]);
        unknown.Items.First().Name.ShouldBe("Prod000");
    }
}
