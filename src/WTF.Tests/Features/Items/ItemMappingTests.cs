using WTF.Api.Features.Items;
using WTF.Domain.Entities;

namespace WTF.Tests.Features.Items;

public class ItemMappingTests
{
    private static User U(string first, string last) => new() { Id = Guid.NewGuid(), FirstName = first, LastName = last };

    [Fact]
    public void NormalizeOptional_TrimsOrReturnsNull()
    {
        ItemValidation.NormalizeOptional(null).ShouldBeNull();
        ItemValidation.NormalizeOptional("  ").ShouldBeNull();
        ItemValidation.NormalizeOptional("  abc ").ShouldBe("abc");
    }

    [Fact]
    public void ToDto_CopiesScalarFields_AndEmptyCollections()
    {
        var item = new Item
        {
            Id = Guid.NewGuid(), Name = "Milk", Sku = "S1", Barcode = "B1", UnitName = "ml",
            StockUnitName = "box", UnitsPerStockUnit = 12, CurrentQuantity = 5.5m, CostPrice = 10m,
            WarningQuantity = 3, CriticalQuantity = 1, IsActive = true,
            CreatedAt = new DateTime(2025, 1, 1), CreatedBy = Guid.NewGuid()
        };

        var dto = ItemMapping.ToDto(item);

        dto.Id.ShouldBe(item.Id);
        dto.Name.ShouldBe("Milk");
        dto.Sku.ShouldBe("S1");
        dto.StockUnitName.ShouldBe("box");
        dto.UnitsPerStockUnit.ShouldBe(12);
        dto.CurrentQuantity.ShouldBe(5.5m);
        dto.CostPrice.ShouldBe(10m);
        dto.IsActive.ShouldBeTrue();
        dto.UpdatedAt.ShouldBeNull();
        dto.PriceHistory.ShouldBeEmpty();
        dto.ProductLinks.ShouldBeEmpty();
        dto.RecentMovements.ShouldBeEmpty();
    }

    [Fact]
    public void ToDto_PriceHistoryNewestFirst_WithTrimmedUserName()
    {
        var item = new Item { Id = Guid.NewGuid(), Name = "x", UnitName = "u" };
        item.ItemPriceHistories.Add(new ItemPriceHistory { Id = Guid.NewGuid(), NewPrice = 1, UpdatedAt = new DateTime(2025, 1, 1), UpdatedByNavigation = U("Ann", "Lee") });
        item.ItemPriceHistories.Add(new ItemPriceHistory { Id = Guid.NewGuid(), NewPrice = 2, OldPrice = 1, UpdatedAt = new DateTime(2025, 3, 1), UpdatedByNavigation = U("Bob", "") });

        var dto = ItemMapping.ToDto(item);

        dto.PriceHistory.Select(h => h.NewPrice).ShouldBe(new[] { 2m, 1m });
        dto.PriceHistory[0].UpdatedByName.ShouldBe("Bob");
        dto.PriceHistory[1].UpdatedByName.ShouldBe("Ann Lee");
        dto.PriceHistory[0].OldPrice.ShouldBe(1m);
    }

    [Fact]
    public void ToDto_LinksOrderedByProductName()
    {
        var item = new Item { Id = Guid.NewGuid(), Name = "x", UnitName = "u" };
        item.ProductItemLinks.Add(new ProductItemLink { Id = Guid.NewGuid(), QuantityPerSale = 1, Product = new Product { Name = "Zebra", Code = "Z" } });
        item.ProductItemLinks.Add(new ProductItemLink { Id = Guid.NewGuid(), QuantityPerSale = 2, IsActive = true, Product = new Product { Name = "Apple", Code = "A" } });

        var dto = ItemMapping.ToDto(item);

        dto.ProductLinks.Select(l => l.ProductName).ShouldBe(new[] { "Apple", "Zebra" });
        dto.ProductLinks[0].ProductCode.ShouldBe("A");
        dto.ProductLinks[0].QuantityPerSale.ShouldBe(2);
        dto.ProductLinks[0].IsActive.ShouldBeTrue();
    }

    [Fact]
    public void ToDto_MovementsNewestFirst()
    {
        var item = new Item { Id = Guid.NewGuid(), Name = "x", UnitName = "u" };
        item.StockMovements.Add(new StockMovement { MovementType = "In", QuantityDelta = 1, CreatedAt = new DateTime(2025, 1, 1), CreatedByNavigation = U("A", "B") });
        item.StockMovements.Add(new StockMovement { MovementType = "Out", QuantityDelta = -1, QuantityBefore = 5, QuantityAfter = 4, Notes = "n", CreatedAt = new DateTime(2025, 2, 1), CreatedByNavigation = U("C", "D") });

        var dto = ItemMapping.ToDto(item);

        dto.RecentMovements.Select(m => m.MovementType).ShouldBe(new[] { "Out", "In" });
        dto.RecentMovements[0].CreatedByName.ShouldBe("C D");
        dto.RecentMovements[0].QuantityBefore.ShouldBe(5);
        dto.RecentMovements[0].QuantityAfter.ShouldBe(4);
        dto.RecentMovements[0].Notes.ShouldBe("n");
    }
}
