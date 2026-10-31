namespace WTF.Domain.Entities;

public partial class User
{
    public Guid Id { get; set; }

    public string Username { get; set; } = null!;

    public string PasswordHash { get; set; } = null!;

    public string FirstName { get; set; } = null!;

    public string LastName { get; set; } = null!;

    public bool IsActive { get; set; }

    public int RoleId { get; set; }

    public DateTime CreatedAt { get; set; }

    public Guid CreatedBy { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public Guid? UpdatedBy { get; set; }

    public virtual ICollection<AuditLog> AuditLogs { get; set; } = new List<AuditLog>();

    public virtual ICollection<ConversationMessage> ConversationMessages { get; set; } = new List<ConversationMessage>();

    public virtual User CreatedByNavigation { get; set; } = null!;

    public virtual ICollection<Customer> CustomerCreatedByNavigations { get; set; } = new List<Customer>();

    public virtual ICollection<Customer> CustomerUpdatedByNavigations { get; set; } = new List<Customer>();

    public virtual ICollection<User> InverseCreatedByNavigation { get; set; } = new List<User>();

    public virtual ICollection<User> InverseUpdatedByNavigation { get; set; } = new List<User>();

    public virtual ICollection<ItemAlertRecipient> ItemAlertRecipientCreatedByNavigations { get; set; } = new List<ItemAlertRecipient>();

    public virtual ICollection<ItemAlertRecipient> ItemAlertRecipientUsers { get; set; } = new List<ItemAlertRecipient>();

    public virtual ICollection<Item> ItemCreatedByNavigations { get; set; } = new List<Item>();

    public virtual ICollection<ItemPriceHistory> ItemPriceHistories { get; set; } = new List<ItemPriceHistory>();

    public virtual ICollection<Item> ItemUpdatedByNavigations { get; set; } = new List<Item>();

    public virtual ICollection<Notification> Notifications { get; set; } = new List<Notification>();

    public virtual ICollection<Order> OrderCreatedByNavigations { get; set; } = new List<Order>();

    public virtual ICollection<Order> OrderUpdatedByNavigations { get; set; } = new List<Order>();

    public virtual ICollection<Product> ProductCreatedByNavigations { get; set; } = new List<Product>();

    public virtual ICollection<ProductItemLink> ProductItemLinkCreatedByNavigations { get; set; } = new List<ProductItemLink>();

    public virtual ICollection<ProductItemLink> ProductItemLinkUpdatedByNavigations { get; set; } = new List<ProductItemLink>();

    public virtual ICollection<ProductPriceHistory> ProductPriceHistories { get; set; } = new List<ProductPriceHistory>();

    public virtual ICollection<ProductSizeAmount> ProductSizeAmountCreatedByNavigations { get; set; } = new List<ProductSizeAmount>();

    public virtual ICollection<ProductSizeAmount> ProductSizeAmountUpdatedByNavigations { get; set; } = new List<ProductSizeAmount>();

    public virtual ICollection<Product> ProductUpdatedByNavigations { get; set; } = new List<Product>();

    public virtual ICollection<Promotion> PromotionCreatedByNavigations { get; set; } = new List<Promotion>();

    public virtual ICollection<Promotion> PromotionUpdatedByNavigations { get; set; } = new List<Promotion>();

    public virtual ICollection<PushNotificationToken> PushNotificationTokens { get; set; } = new List<PushNotificationToken>();

    public virtual ICollection<RefreshToken> RefreshTokens { get; set; } = new List<RefreshToken>();

    public virtual UserRole Role { get; set; } = null!;

    public virtual ICollection<ShortLink> ShortLinks { get; set; } = new List<ShortLink>();

    public virtual ICollection<StockMovement> StockMovements { get; set; } = new List<StockMovement>();

    public virtual ICollection<StockWaste> StockWasteCreatedByNavigations { get; set; } = new List<StockWaste>();

    public virtual ICollection<StockWaste> StockWasteReversedByNavigations { get; set; } = new List<StockWaste>();

    public virtual ICollection<StockWaste> StockWasteReviewedByNavigations { get; set; } = new List<StockWaste>();

    public virtual User? UpdatedByNavigation { get; set; }

    public virtual UserImage? UserImage { get; set; }

    public virtual ICollection<WasteReason> WasteReasonCreatedByNavigations { get; set; } = new List<WasteReason>();

    public virtual ICollection<WasteReason> WasteReasonUpdatedByNavigations { get; set; } = new List<WasteReason>();
}
