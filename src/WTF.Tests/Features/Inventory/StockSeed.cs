using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

internal static class StockSeed
{
    public static Guid Item(
        string dbName,
        string name,
        decimal quantity,
        bool allowNegative = true,
        bool active = true,
        decimal? cost = null,
        decimal? warning = null,
        decimal? critical = null)
    {
        using var db = TestDb.Create(dbName);
        var item = new Item
        {
            Id = Guid.NewGuid(),
            Name = name,
            UnitName = "ml",
            CurrentQuantity = quantity,
            AllowNegativeStock = allowNegative,
            IsActive = active,
            CostPrice = cost,
            WarningQuantity = warning,
            CriticalQuantity = critical,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = Guid.NewGuid()
        };
        db.Items.Add(item);
        db.SaveChanges();
        return item.Id;
    }

    public static Guid Link(string dbName, Guid productId, Guid itemId, decimal quantityPerSale, bool active = true)
    {
        using var db = TestDb.Create(dbName);
        var link = new ProductItemLink
        {
            Id = Guid.NewGuid(),
            ProductId = productId,
            ItemId = itemId,
            QuantityPerSale = quantityPerSale,
            IsActive = active,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = Guid.NewGuid()
        };
        db.ProductItemLinks.Add(link);
        db.SaveChanges();
        return link.Id;
    }

    public static void SetLinkQuantity(string dbName, Guid linkId, decimal quantityPerSale)
    {
        using var db = TestDb.Create(dbName);
        db.ProductItemLinks.Single(l => l.Id == linkId).QuantityPerSale = quantityPerSale;
        db.SaveChanges();
    }

    public static decimal Balance(string dbName, Guid itemId)
    {
        using var db = TestDb.Create(dbName);
        return db.Items.Single(i => i.Id == itemId).CurrentQuantity;
    }

    public static List<StockMovement> Movements(string dbName, Guid itemId)
    {
        using var db = TestDb.Create(dbName);
        return db.StockMovements.Where(m => m.ItemId == itemId).OrderBy(m => m.CreatedAt).ThenBy(m => m.QuantityBefore).ToList();
    }
}
