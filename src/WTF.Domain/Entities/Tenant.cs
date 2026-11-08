using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class Tenant
{
    public Guid Id { get; set; }

    public string Name { get; set; } = null!;

    public string Slug { get; set; } = null!;

    public byte Status { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public virtual ICollection<AddOnType> AddOnTypes { get; set; } = new List<AddOnType>();

    public virtual ICollection<AuditLog> AuditLogs { get; set; } = new List<AuditLog>();

    public virtual ICollection<ConversationMessage> ConversationMessages { get; set; } = new List<ConversationMessage>();

    public virtual ICollection<Conversation> Conversations { get; set; } = new List<Conversation>();

    public virtual ICollection<CustomerImage> CustomerImages { get; set; } = new List<CustomerImage>();

    public virtual ICollection<Customer> Customers { get; set; } = new List<Customer>();

    public virtual ICollection<DiscountedProductPromotionAddOn> DiscountedProductPromotionAddOns { get; set; } = new List<DiscountedProductPromotionAddOn>();

    public virtual ICollection<DiscountedProductPromotion> DiscountedProductPromotions { get; set; } = new List<DiscountedProductPromotion>();

    public virtual ICollection<Expense> Expenses { get; set; } = new List<Expense>();

    public virtual ICollection<FixedBundlePromotionItemAddOn> FixedBundlePromotionItemAddOns { get; set; } = new List<FixedBundlePromotionItemAddOn>();

    public virtual ICollection<FixedBundlePromotionItem> FixedBundlePromotionItems { get; set; } = new List<FixedBundlePromotionItem>();

    public virtual ICollection<FixedBundlePromotion> FixedBundlePromotions { get; set; } = new List<FixedBundlePromotion>();

    public virtual ICollection<Image> Images { get; set; } = new List<Image>();

    public virtual ICollection<ItemAlertRecipient> ItemAlertRecipients { get; set; } = new List<ItemAlertRecipient>();

    public virtual ICollection<ItemPriceHistory> ItemPriceHistories { get; set; } = new List<ItemPriceHistory>();

    public virtual ICollection<Item> Items { get; set; } = new List<Item>();

    public virtual ICollection<LoyaltyPoint> LoyaltyPoints { get; set; } = new List<LoyaltyPoint>();

    public virtual ICollection<MixMatchPromotionProductAddOn> MixMatchPromotionProductAddOns { get; set; } = new List<MixMatchPromotionProductAddOn>();

    public virtual ICollection<MixMatchPromotionProduct> MixMatchPromotionProducts { get; set; } = new List<MixMatchPromotionProduct>();

    public virtual ICollection<MixMatchPromotion> MixMatchPromotions { get; set; } = new List<MixMatchPromotion>();

    public virtual ICollection<Notification> Notifications { get; set; } = new List<Notification>();

    public virtual ICollection<OrderBundlePromotion> OrderBundlePromotions { get; set; } = new List<OrderBundlePromotion>();

    public virtual ICollection<OrderItem> OrderItems { get; set; } = new List<OrderItem>();

    public virtual ICollection<Order> Orders { get; set; } = new List<Order>();

    public virtual ICollection<ProductAddOnPriceOverride> ProductAddOnPriceOverrides { get; set; } = new List<ProductAddOnPriceOverride>();

    public virtual ICollection<ProductAddOn> ProductAddOns { get; set; } = new List<ProductAddOn>();

    public virtual ICollection<ProductCategory> ProductCategories { get; set; } = new List<ProductCategory>();

    public virtual ICollection<ProductImage> ProductImages { get; set; } = new List<ProductImage>();

    public virtual ICollection<ProductItemLink> ProductItemLinks { get; set; } = new List<ProductItemLink>();

    public virtual ICollection<ProductPriceHistory> ProductPriceHistories { get; set; } = new List<ProductPriceHistory>();

    public virtual ICollection<ProductSizeAmount> ProductSizeAmounts { get; set; } = new List<ProductSizeAmount>();

    public virtual ICollection<ProductSubCategory> ProductSubCategories { get; set; } = new List<ProductSubCategory>();

    public virtual ICollection<Product> Products { get; set; } = new List<Product>();

    public virtual ICollection<PromotionImage> PromotionImages { get; set; } = new List<PromotionImage>();

    public virtual ICollection<Promotion> Promotions { get; set; } = new List<Promotion>();

    public virtual ICollection<PushNotificationToken> PushNotificationTokens { get; set; } = new List<PushNotificationToken>();

    public virtual ICollection<RefreshToken> RefreshTokens { get; set; } = new List<RefreshToken>();

    public virtual ICollection<ShortLink> ShortLinks { get; set; } = new List<ShortLink>();

    public virtual ICollection<StockCountLine> StockCountLines { get; set; } = new List<StockCountLine>();

    public virtual ICollection<StockCount> StockCounts { get; set; } = new List<StockCount>();

    public virtual ICollection<StockMovement> StockMovements { get; set; } = new List<StockMovement>();

    public virtual ICollection<StockWaste> StockWastes { get; set; } = new List<StockWaste>();

    public virtual ICollection<TenantCounter> TenantCounters { get; set; } = new List<TenantCounter>();

    public virtual ICollection<TenantInvoice> TenantInvoices { get; set; } = new List<TenantInvoice>();

    public virtual TenantSetting? TenantSetting { get; set; }

    public virtual TenantSubscription? TenantSubscription { get; set; }

    public virtual ICollection<UserImage> UserImages { get; set; } = new List<UserImage>();

    public virtual ICollection<User> Users { get; set; } = new List<User>();

    public virtual ICollection<WasteReason> WasteReasons { get; set; } = new List<WasteReason>();
}
