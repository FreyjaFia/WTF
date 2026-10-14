using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Tests.Features.Reports;

/// <summary>Seeding helpers shared by the report and dashboard tests. Nothing is saved until the caller saves.</summary>
internal static class SalesSeed
{
    public static readonly Guid StaffA = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
    public static readonly Guid StaffB = Guid.Parse("bbbbbbbb-0000-0000-0000-000000000002");

    public const int Pending = 1, Completed = 2, Cancelled = 3, Refunded = 4;
    public const int Cash = 1, Card = 2;
    public const int FoodCategory = 1, DrinksCategory = 2;
    public const int BurgerSub = 1, SideSub = 2;

    private static int _orderNumber;

    public static DateTime Utc(int y, int m, int d, int h = 0, int min = 0, int s = 0) =>
        new(y, m, d, h, min, s, DateTimeKind.Utc);

    public static void Basics(WTFDbContext db)
    {
        db.Statuses.AddRange(
            new Status { Id = Pending, Name = "Pending" },
            new Status { Id = Completed, Name = "Completed" },
            new Status { Id = Cancelled, Name = "Cancelled" },
            new Status { Id = Refunded, Name = "Refunded" });
        db.PaymentMethods.AddRange(
            new PaymentMethod { Id = Cash, Name = "Cash" },
            new PaymentMethod { Id = Card, Name = "Card" });
        db.Users.AddRange(
            new User { Id = StaffA, Username = "ana", PasswordHash = "x", FirstName = "Ana", LastName = "Cruz", IsActive = true },
            new User { Id = StaffB, Username = "ben", PasswordHash = "x", FirstName = "Ben", LastName = "Reyes", IsActive = true });
        db.ProductCategories.AddRange(
            new ProductCategory { Id = FoodCategory, Name = "Food" },
            new ProductCategory { Id = DrinksCategory, Name = "Drinks" });
        db.ProductSubCategories.AddRange(
            new ProductSubCategory { Id = BurgerSub, Name = "Burgers" },
            new ProductSubCategory { Id = SideSub, Name = "Sides" });
    }

    public static Product Product(WTFDbContext db, string name, decimal price, int categoryId = FoodCategory, int? subCategoryId = null)
    {
        var product = new Product
        {
            Id = Guid.NewGuid(),
            Name = name,
            Code = name,
            Price = price,
            CategoryId = categoryId,
            SubCategoryId = subCategoryId,
            IsActive = true,
        };
        db.Products.Add(product);
        return product;
    }

    public static Promotion Promotion(WTFDbContext db, string name, int typeId)
    {
        var promotion = new Promotion { Id = Guid.NewGuid(), Name = name, TypeId = typeId, IsActive = true };
        db.Promotions.Add(promotion);
        return promotion;
    }

    public static Order Order(
        WTFDbContext db, DateTime createdAtUtc, int status = Completed, Guid? by = null,
        int? payment = Cash, decimal? tips = null, Guid? customerId = null)
    {
        var order = new Order
        {
            Id = Guid.NewGuid(),
            OrderNumber = Interlocked.Increment(ref _orderNumber),
            CreatedAt = createdAtUtc,
            CreatedBy = by ?? StaffA,
            StatusId = status,
            PaymentMethodId = payment,
            Tips = tips,
            CustomerId = customerId,
        };
        db.Orders.Add(order);
        return order;
    }

    public static OrderItem Item(
        WTFDbContext db, Order order, Product product, int quantity = 1, decimal? price = null, OrderItem? parent = null)
    {
        var item = new OrderItem
        {
            Id = Guid.NewGuid(),
            OrderId = order.Id,
            ProductId = product.Id,
            Quantity = quantity,
            Price = price,
            ParentOrderItemId = parent?.Id,
        };
        db.OrderItems.Add(item);
        return item;
    }

    public static void Bundle(WTFDbContext db, Order order, Promotion promotion, int quantity, decimal unitPrice) =>
        db.OrderBundlePromotions.Add(new OrderBundlePromotion
        {
            Id = Guid.NewGuid(),
            OrderId = order.Id,
            PromotionId = promotion.Id,
            Quantity = quantity,
            UnitPrice = unitPrice,
        });

    /// <summary>A completed order worth exactly <paramref name="amount"/> (one item priced at that amount).</summary>
    public static Order Sale(
        WTFDbContext db, Product product, DateTime createdAtUtc, decimal amount, int status = Completed,
        Guid? by = null, int? payment = Cash, decimal? tips = null)
    {
        var order = Order(db, createdAtUtc, status, by, payment, tips);
        Item(db, order, product, 1, amount);
        return order;
    }
}
