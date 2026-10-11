using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Products.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Orders;

/// <summary>Seeds products, orders and promotions for the order update, void and read handler tests.</summary>
internal sealed class OrderSeed(string dbName)
{
    private static int _orderNumber = 1000;

    public string DbName { get; } = dbName;

    public WTFDbContext Open() => TestDb.Create(DbName);

    public Guid AddProduct(string name, decimal price, bool isActive = true, bool isAddOn = false)
    {
        using var db = Open();
        var id = Guid.NewGuid();
        db.Products.Add(new Product
        {
            Id = id,
            Name = name,
            Code = name.ToUpperInvariant(),
            Price = price,
            IsActive = isActive,
            IsAddOn = isAddOn,
            CategoryId = 1,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = Guid.NewGuid(),
        });
        db.SaveChanges();
        return id;
    }

    public void AllowAddOn(Guid productId, Guid addOnId, AddOnTypeEnum type = AddOnTypeEnum.Extra, bool isActive = true)
    {
        using var db = Open();
        db.ProductAddOns.Add(new ProductAddOn
        {
            ProductId = productId,
            AddOnId = addOnId,
            AddOnTypeId = (int)type,
            IsActive = isActive,
        });
        db.SaveChanges();
    }

    public void AddAddOnPriceOverride(Guid productId, Guid addOnId, decimal price, bool isActive = true)
    {
        using var db = Open();
        db.ProductAddOnPriceOverrides.Add(new ProductAddOnPriceOverride
        {
            Id = Guid.NewGuid(),
            ProductId = productId,
            AddOnId = addOnId,
            Price = price,
            IsActive = isActive,
            CreatedAt = DateTime.UtcNow,
        });
        db.SaveChanges();
    }

    public Guid AddCustomer(string first, string last)
    {
        using var db = Open();
        var id = Guid.NewGuid();
        db.Customers.Add(new Customer
        {
            Id = id,
            FirstName = first,
            LastName = last,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = Guid.NewGuid(),
        });
        db.SaveChanges();
        return id;
    }

    public Guid AddOrder(
        OrderStatusEnum status = OrderStatusEnum.Pending,
        Guid? customerId = null,
        DateTime? createdAt = null,
        int? orderNumber = null,
        string? note = null,
        PaymentMethodEnum? paymentMethod = null)
    {
        using var db = Open();
        var id = Guid.NewGuid();
        db.Orders.Add(new Order
        {
            Id = id,
            OrderNumber = orderNumber ?? Interlocked.Increment(ref _orderNumber),
            CustomerId = customerId,
            CreatedAt = createdAt ?? DateTime.UtcNow,
            CreatedBy = Guid.NewGuid(),
            StatusId = (int)status,
            PaymentMethodId = paymentMethod.HasValue ? (int)paymentMethod.Value : null,
            Note = note,
        });
        db.SaveChanges();
        return id;
    }

    public Guid AddLine(
        Guid orderId,
        Guid productId,
        int quantity = 1,
        decimal? price = null,
        Guid? parentId = null,
        int sortOrder = 0,
        decimal? originalPrice = null,
        string? promoLabel = null,
        Guid? bundleId = null)
    {
        using var db = Open();
        var id = Guid.NewGuid();
        db.OrderItems.Add(new OrderItem
        {
            Id = id,
            OrderId = orderId,
            ProductId = productId,
            Quantity = quantity,
            Price = price,
            ParentOrderItemId = parentId,
            SortOrder = sortOrder,
            OriginalPrice = originalPrice,
            PromoLabel = promoLabel,
            BundlePromotionId = bundleId,
        });
        db.SaveChanges();
        return id;
    }

    public Guid AddFixedBundle(string name, decimal bundlePrice, bool isActive = true, DateTime? start = null, DateTime? end = null)
    {
        using var db = Open();
        var id = Guid.NewGuid();
        db.Promotions.Add(new Promotion
        {
            Id = id,
            Name = name,
            TypeId = 1,
            IsActive = isActive,
            StartDate = start,
            EndDate = end,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = Guid.NewGuid(),
            FixedBundlePromotion = new FixedBundlePromotion { PromotionId = id, BundlePrice = bundlePrice },
        });
        db.SaveChanges();
        return id;
    }

    /// <summary>A "discounted product" promotion that applies when the product is ordered with exactly the given add-on.</summary>
    public void AddDiscountedProductPromo(Guid productId, Guid requiredAddOnId, decimal? percentOff, decimal? fixedPrice = null)
    {
        using var db = Open();
        var promoId = Guid.NewGuid();
        var ruleId = Guid.NewGuid();
        db.Promotions.Add(new Promotion
        {
            Id = promoId,
            Name = "Promo",
            TypeId = 3,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = Guid.NewGuid(),
        });
        db.DiscountedProductPromotions.Add(new DiscountedProductPromotion
        {
            Id = ruleId,
            PromotionId = promoId,
            ProductId = productId,
            PercentOff = percentOff,
            FixedPrice = fixedPrice,
        });
        db.DiscountedProductPromotionAddOns.Add(new DiscountedProductPromotionAddOn
        {
            Id = Guid.NewGuid(),
            DiscountedProductPromotionId = ruleId,
            AddOnProductId = requiredAddOnId,
            Quantity = 1,
        });
        db.SaveChanges();
    }
}
