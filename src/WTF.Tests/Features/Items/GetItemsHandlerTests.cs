using WTF.Api.Features.Items;
using WTF.Api.Features.Items.DTOs;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Items;

public class GetItemsHandlerTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();

    private Task<List<ItemDto>> Run(GetItemsQuery q) =>
        new GetItemsHandler(TestDb.Create(_db)).Handle(q, CancellationToken.None);

    private async Task Seed()
    {
        await ItemSeed.Item(_db, _userId, "Sugar", sku: "S-1", barcode: "111");
        await ItemSeed.Item(_db, _userId, "Butter", sku: "B-1", barcode: "222");
        await ItemSeed.Item(_db, _userId, "Old Salt", sku: "O-1", barcode: "333", active: false);
    }

    [Fact]
    public async Task Handle_Default_ReturnsActiveItemsOrderedByName()
    {
        await Seed();
        (await Run(new GetItemsQuery())).Select(i => i.Name).ShouldBe(["Butter", "Sugar"]);
    }

    [Fact]
    public async Task Handle_IncludeInactive_ReturnsAll()
    {
        await Seed();
        (await Run(new GetItemsQuery(IncludeInactive: true))).Select(i => i.Name).ShouldBe(["Butter", "Old Salt", "Sugar"]);
    }

    [Fact]
    public async Task Handle_IsActiveFalseWithIncludeInactive_ReturnsOnlyInactive()
    {
        await Seed();
        (await Run(new GetItemsQuery(IsActive: false, IncludeInactive: true))).Select(i => i.Name).ShouldBe(["Old Salt"]);
    }

    [Fact]
    public async Task Handle_IsActiveFalseWithoutIncludeInactive_ReturnsNothing()
    {
        await Seed();
        (await Run(new GetItemsQuery(IsActive: false))).ShouldBeEmpty();
    }

    [Theory]
    [InlineData("Sug", "Sugar")]
    [InlineData("  B-1 ", "Butter")]
    [InlineData("222", "Butter")]
    public async Task Handle_SearchTerm_MatchesNameSkuOrBarcodeTrimmed(string term, string expected)
    {
        await Seed();
        (await Run(new GetItemsQuery(SearchTerm: term))).Select(i => i.Name).ShouldBe([expected]);
    }

    [Fact]
    public async Task Handle_BlankSearchTerm_IsIgnored()
    {
        await Seed();
        (await Run(new GetItemsQuery(SearchTerm: "   "))).Count.ShouldBe(2);
    }

    [Fact]
    public async Task Handle_ItemWithLink_IncludesProductLink()
    {
        var item = await ItemSeed.Item(_db, _userId, "Milk");
        var product = await ItemSeed.Product(_db, _userId, "Latte", "LAT");
        await using (var db = TestDb.Create(_db))
        {
            db.ProductItemLinks.Add(new ProductItemLink
            {
                Id = Guid.NewGuid(), ItemId = item.Id, ProductId = product.Id, QuantityPerSale = 0.2m, IsActive = true,
                CreatedAt = DateTime.UtcNow, CreatedBy = _userId
            });
            await db.SaveChangesAsync();
        }

        var link = (await Run(new GetItemsQuery())).Single().ProductLinks.Single();
        link.ProductName.ShouldBe("Latte");
        link.ProductCode.ShouldBe("LAT");
        link.QuantityPerSale.ShouldBe(0.2m);
    }
}
