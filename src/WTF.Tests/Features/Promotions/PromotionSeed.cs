using WTF.Api.Features.Promotions.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Tests.Features.Promotions;

/// <summary>Seeding helpers shared by the promotion handler tests.</summary>
internal static class PromotionSeed
{
    public static readonly DateTime Now = new(2026, 6, 15, 12, 0, 0, DateTimeKind.Utc);

    public static async Task SeedProductsAsync(WTFDbContext db, Guid createdBy, params (Guid Id, string Name, bool IsAddOn)[] products)
    {
        foreach (var (id, name, isAddOn) in products)
        {
            db.Products.Add(new Product
            {
                Id = id,
                Name = name,
                Code = name.ToUpperInvariant(),
                Price = 10m,
                CategoryId = 1,
                IsAddOn = isAddOn,
                IsActive = true,
                CreatedAt = Now,
                CreatedBy = createdBy
            });
        }

        await db.SaveChangesAsync();
    }

    public static async Task LinkAddOnAsync(WTFDbContext db, Guid productId, Guid addOnId, bool isActive = true)
    {
        db.ProductAddOns.Add(new ProductAddOn { ProductId = productId, AddOnId = addOnId, IsActive = isActive });
        await db.SaveChangesAsync();
    }

    public static Promotion NewPromotion(int typeId, string name = "Promo", bool isActive = true,
        DateTime? start = null, DateTime? end = null) => new()
        {
            Id = Guid.NewGuid(),
            Name = name,
            TypeId = typeId,
            IsActive = isActive,
            StartDate = start,
            EndDate = end,
            CreatedAt = Now.AddDays(-30),
            CreatedBy = Guid.NewGuid()
        };

    public static async Task<Promotion> AddBundleAsync(WTFDbContext db, Guid productId, int quantity, decimal price,
        Guid? addOnId = null, int addOnQty = 1, bool isActive = true, DateTime? start = null, DateTime? end = null,
        string name = "Bundle")
    {
        var promo = NewPromotion(PromotionTypeIds.FixedBundle, name, isActive, start, end);
        var item = new FixedBundlePromotionItem { Id = Guid.NewGuid(), ProductId = productId, Quantity = quantity };
        if (addOnId.HasValue)
        {
            item.FixedBundlePromotionItemAddOns.Add(new FixedBundlePromotionItemAddOn
            { Id = Guid.NewGuid(), AddOnProductId = addOnId.Value, Quantity = addOnQty });
        }
        promo.FixedBundlePromotion = new FixedBundlePromotion { BundlePrice = price };
        promo.FixedBundlePromotion.FixedBundlePromotionItems.Add(item);
        db.Promotions.Add(promo);
        await db.SaveChangesAsync();
        return promo;
    }

    public static async Task<Promotion> AddDiscountAsync(WTFDbContext db, Guid productId, Guid addOnId, int addOnQty,
        decimal? fixedPrice, decimal? percentOff, bool isActive = true, DateTime? start = null, DateTime? end = null,
        string name = "Discount")
    {
        var promo = NewPromotion(PromotionTypeIds.DiscountedProduct, name, isActive, start, end);
        var item = new DiscountedProductPromotion
        {
            Id = Guid.NewGuid(),
            ProductId = productId,
            FixedPrice = fixedPrice,
            PercentOff = percentOff
        };
        item.DiscountedProductPromotionAddOns.Add(new DiscountedProductPromotionAddOn
        { Id = Guid.NewGuid(), AddOnProductId = addOnId, Quantity = addOnQty });
        promo.DiscountedProductPromotions.Add(item);
        db.Promotions.Add(promo);
        await db.SaveChangesAsync();
        return promo;
    }

    public static async Task<Promotion> AddMixMatchAsync(WTFDbContext db, string name = "Mix", bool isActive = true)
    {
        var promo = NewPromotion(PromotionTypeIds.MixMatch, name, isActive);
        promo.MixMatchPromotion = new MixMatchPromotion { RequiredQuantity = 2, BundlePrice = 10m };
        promo.MixMatchPromotion.MixMatchPromotionProducts.Add(new MixMatchPromotionProduct
        { Id = Guid.NewGuid(), ProductId = Guid.NewGuid() });
        db.Promotions.Add(promo);
        await db.SaveChangesAsync();
        return promo;
    }
}
