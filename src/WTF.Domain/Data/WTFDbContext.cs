using Microsoft.EntityFrameworkCore;
using WTF.Domain.Entities;

namespace WTF.Domain.Data;

public partial class WTFDbContext : DbContext
{
    public WTFDbContext()
    {
    }

    public WTFDbContext(DbContextOptions<WTFDbContext> options)
        : base(options)
    {
    }

    public virtual DbSet<AddOnType> AddOnTypes { get; set; }

    public virtual DbSet<AuditLog> AuditLogs { get; set; }

    public virtual DbSet<Conversation> Conversations { get; set; }

    public virtual DbSet<ConversationMessage> ConversationMessages { get; set; }

    public virtual DbSet<Customer> Customers { get; set; }

    public virtual DbSet<CustomerImage> CustomerImages { get; set; }

    public virtual DbSet<DiscountedProductPromotion> DiscountedProductPromotions { get; set; }

    public virtual DbSet<DiscountedProductPromotionAddOn> DiscountedProductPromotionAddOns { get; set; }

    public virtual DbSet<Expense> Expenses { get; set; }

    public virtual DbSet<FixedBundlePromotion> FixedBundlePromotions { get; set; }

    public virtual DbSet<FixedBundlePromotionItem> FixedBundlePromotionItems { get; set; }

    public virtual DbSet<FixedBundlePromotionItemAddOn> FixedBundlePromotionItemAddOns { get; set; }

    public virtual DbSet<Image> Images { get; set; }

    public virtual DbSet<Item> Items { get; set; }

    public virtual DbSet<ItemAlertRecipient> ItemAlertRecipients { get; set; }

    public virtual DbSet<ItemPriceHistory> ItemPriceHistories { get; set; }

    public virtual DbSet<ItemSupplier> ItemSuppliers { get; set; }

    public virtual DbSet<ItemSupplierPriceHistory> ItemSupplierPriceHistories { get; set; }

    public virtual DbSet<LoyaltyPoint> LoyaltyPoints { get; set; }

    public virtual DbSet<MixMatchPromotion> MixMatchPromotions { get; set; }

    public virtual DbSet<MixMatchPromotionProduct> MixMatchPromotionProducts { get; set; }

    public virtual DbSet<MixMatchPromotionProductAddOn> MixMatchPromotionProductAddOns { get; set; }

    public virtual DbSet<Notification> Notifications { get; set; }

    public virtual DbSet<Order> Orders { get; set; }

    public virtual DbSet<OrderBundlePromotion> OrderBundlePromotions { get; set; }

    public virtual DbSet<OrderItem> OrderItems { get; set; }

    public virtual DbSet<OrderSeniorPwdDiscount> OrderSeniorPwdDiscounts { get; set; }

    public virtual DbSet<PaymentMethod> PaymentMethods { get; set; }

    public virtual DbSet<Plan> Plans { get; set; }

    public virtual DbSet<PlatformAdmin> PlatformAdmins { get; set; }

    public virtual DbSet<PlatformAuditLog> PlatformAuditLogs { get; set; }

    public virtual DbSet<Product> Products { get; set; }

    public virtual DbSet<ProductAddOn> ProductAddOns { get; set; }

    public virtual DbSet<ProductAddOnPriceOverride> ProductAddOnPriceOverrides { get; set; }

    public virtual DbSet<ProductCategory> ProductCategories { get; set; }

    public virtual DbSet<ProductImage> ProductImages { get; set; }

    public virtual DbSet<ProductItemLink> ProductItemLinks { get; set; }

    public virtual DbSet<ProductPriceHistory> ProductPriceHistories { get; set; }

    public virtual DbSet<ProductSizeAmount> ProductSizeAmounts { get; set; }

    public virtual DbSet<ProductSubCategory> ProductSubCategories { get; set; }

    public virtual DbSet<Promotion> Promotions { get; set; }

    public virtual DbSet<PromotionImage> PromotionImages { get; set; }

    public virtual DbSet<PurchaseOrder> PurchaseOrders { get; set; }

    public virtual DbSet<PurchaseOrderLine> PurchaseOrderLines { get; set; }

    public virtual DbSet<PushNotificationToken> PushNotificationTokens { get; set; }

    public virtual DbSet<RefreshToken> RefreshTokens { get; set; }

    public virtual DbSet<RolePermission> RolePermissions { get; set; }

    public virtual DbSet<SchemaScriptHistory> SchemaScriptHistories { get; set; }

    public virtual DbSet<ShortLink> ShortLinks { get; set; }

    public virtual DbSet<Status> Statuses { get; set; }

    public virtual DbSet<StockCount> StockCounts { get; set; }

    public virtual DbSet<StockCountLine> StockCountLines { get; set; }

    public virtual DbSet<StockMovement> StockMovements { get; set; }

    public virtual DbSet<StockReceipt> StockReceipts { get; set; }

    public virtual DbSet<StockReceiptLine> StockReceiptLines { get; set; }

    public virtual DbSet<StockWaste> StockWastes { get; set; }

    public virtual DbSet<Supplier> Suppliers { get; set; }

    public virtual DbSet<Tenant> Tenants { get; set; }

    public virtual DbSet<TenantCounter> TenantCounters { get; set; }

    public virtual DbSet<TenantInvoice> TenantInvoices { get; set; }

    public virtual DbSet<TenantSetting> TenantSettings { get; set; }

    public virtual DbSet<TenantSubscription> TenantSubscriptions { get; set; }

    public virtual DbSet<TenantTombstone> TenantTombstones { get; set; }

    public virtual DbSet<User> Users { get; set; }

    public virtual DbSet<UserImage> UserImages { get; set; }

    public virtual DbSet<UserRole> UserRoles { get; set; }

    public virtual DbSet<WasteReason> WasteReasons { get; set; }

    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
        => optionsBuilder.UseSqlServer("Name=ConnectionStrings:WtfDb");

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AddOnType>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__AddOnTyp__3214EC07A570BCFD");

            entity.ToTable("AddOnType");

            entity.HasIndex(e => new { e.TenantId, e.SystemKey }, "UX_AddOnType_SystemKey")
                .IsUnique()
                .HasFilter("([SystemKey] IS NOT NULL)");

            entity.Property(e => e.Id).ValueGeneratedNever();
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("(sysutcdatetime())", "DF_AddOnType_CreatedAt");
            entity.Property(e => e.IsActive).HasDefaultValue(true, "DF_AddOnType_IsActive");
            entity.Property(e => e.Name).HasMaxLength(50);
            entity.Property(e => e.SystemKey)
                .HasMaxLength(20)
                .IsUnicode(false);
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_AddOnType_TenantId");

            entity.HasOne(d => d.Tenant).WithMany(p => p.AddOnTypes)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_AddOnType_Tenants");
        });

        modelBuilder.Entity<AuditLog>(entity =>
        {
            entity.ToTable("AuditLog");

            entity.HasIndex(e => e.Action, "IX_AuditLog_Action");

            entity.HasIndex(e => e.EntityType, "IX_AuditLog_EntityType");

            entity.HasIndex(e => e.TenantId, "IX_AuditLog_TenantId");

            entity.HasIndex(e => e.Timestamp, "IX_AuditLog_Timestamp").IsDescending();

            entity.HasIndex(e => e.UserId, "IX_AuditLog_UserId");

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_AuditLog_Id");
            entity.Property(e => e.Action).HasMaxLength(50);
            entity.Property(e => e.EntityId).HasMaxLength(50);
            entity.Property(e => e.EntityType).HasMaxLength(50);
            entity.Property(e => e.IpAddress).HasMaxLength(50);
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_AuditLog_TenantId");
            entity.Property(e => e.Timestamp).HasDefaultValueSql("(getutcdate())", "DF_AuditLog_Timestamp");

            entity.HasOne(d => d.Tenant).WithMany(p => p.AuditLogs)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_AuditLog_Tenants");

            entity.HasOne(d => d.User).WithMany(p => p.AuditLogs)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_AuditLog_Users");
        });

        modelBuilder.Entity<Conversation>(entity =>
        {
            entity.HasIndex(e => new { e.CustomerId, e.LastMessageAt }, "IX_Conversations_CustomerId_LastMessageAt").IsDescending(false, true);

            entity.HasIndex(e => e.LastMessageAt, "IX_Conversations_LastMessageAt").IsDescending();

            entity.HasIndex(e => e.OrderId, "UX_Conversations_OrderId")
                .IsUnique()
                .HasFilter("([OrderId] IS NOT NULL)");

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_Conversations_Id");
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("(sysutcdatetime())", "DF_Conversations_CreatedAt");
            entity.Property(e => e.LastMessageAt).HasDefaultValueSql("(sysutcdatetime())", "DF_Conversations_LastMessageAt");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_Conversations_TenantId");
            entity.Property(e => e.Title).HasMaxLength(100);

            entity.HasOne(d => d.Customer).WithMany(p => p.Conversations)
                .HasForeignKey(d => d.CustomerId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Conversations_Customer");

            entity.HasOne(d => d.Order).WithOne(p => p.Conversation)
                .HasForeignKey<Conversation>(d => d.OrderId)
                .HasConstraintName("FK_Conversations_Order");

            entity.HasOne(d => d.Tenant).WithMany(p => p.Conversations)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Conversations_Tenants");
        });

        modelBuilder.Entity<ConversationMessage>(entity =>
        {
            entity.HasIndex(e => new { e.ConversationId, e.CreatedAt }, "IX_ConversationMessages_ConversationId_CreatedAt");

            entity.HasIndex(e => new { e.ConversationId, e.CreatedAt }, "IX_ConversationMessages_Images").HasFilter("([ImageKey] IS NOT NULL)");

            entity.HasIndex(e => e.TenantId, "IX_ConversationMessages_TenantId");

            entity.HasIndex(e => e.ConversationId, "IX_ConversationMessages_UnreadForCustomer").HasFilter("([SenderType]=(1) AND [ReadByCustomerAt] IS NULL)");

            entity.HasIndex(e => e.ConversationId, "IX_ConversationMessages_UnreadForStaff").HasFilter("([SenderType]=(0) AND [ReadByStaffAt] IS NULL)");

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_ConversationMessages_Id");
            entity.Property(e => e.Body).HasMaxLength(1000);
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("(sysutcdatetime())", "DF_ConversationMessages_CreatedAt");
            entity.Property(e => e.ImageContentType)
                .HasMaxLength(50)
                .IsUnicode(false);
            entity.Property(e => e.ImageKey).HasMaxLength(200);
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_ConversationMessages_TenantId");

            entity.HasOne(d => d.Conversation).WithMany(p => p.ConversationMessages)
                .HasForeignKey(d => d.ConversationId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ConversationMessages_Conversation");

            entity.HasOne(d => d.SenderUser).WithMany(p => p.ConversationMessages)
                .HasForeignKey(d => d.SenderUserId)
                .HasConstraintName("FK_ConversationMessages_SenderUser");

            entity.HasOne(d => d.Tenant).WithMany(p => p.ConversationMessages)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ConversationMessages_Tenants");
        });

        modelBuilder.Entity<Customer>(entity =>
        {
            entity.HasIndex(e => e.CreatedBy, "IX_Customers_CreatedBy");

            entity.HasIndex(e => e.TenantId, "IX_Customers_TenantId");

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_Customers_Id");
            entity.Property(e => e.Address).IsUnicode(false);
            entity.Property(e => e.ContactNumber).HasMaxLength(30);
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("(getutcdate())", "DF_Customers_CreatedAt")
                .HasColumnType("datetime");
            entity.Property(e => e.FirstName)
                .HasMaxLength(50)
                .IsUnicode(false);
            entity.Property(e => e.IsActive).HasDefaultValue(true, "DF_Customers_IsActive");
            entity.Property(e => e.LastName)
                .HasMaxLength(50)
                .IsUnicode(false);
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_Customers_TenantId");
            entity.Property(e => e.UpdatedAt).HasColumnType("datetime");

            entity.HasOne(d => d.CreatedByNavigation).WithMany(p => p.CustomerCreatedByNavigations)
                .HasForeignKey(d => d.CreatedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Customers_CreatedBy");

            entity.HasOne(d => d.Tenant).WithMany(p => p.Customers)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Customers_Tenants");

            entity.HasOne(d => d.UpdatedByNavigation).WithMany(p => p.CustomerUpdatedByNavigations)
                .HasForeignKey(d => d.UpdatedBy)
                .HasConstraintName("FK_Customers_UpdatedBy");
        });

        modelBuilder.Entity<CustomerImage>(entity =>
        {
            entity.HasKey(e => new { e.CustomerId, e.ImageId });

            entity.HasIndex(e => e.CustomerId, "UQ_CustomerImages_CustomerId").IsUnique();

            entity.HasIndex(e => e.ImageId, "UQ_CustomerImages_ImageId").IsUnique();

            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_CustomerImages_TenantId");

            entity.HasOne(d => d.Customer).WithOne(p => p.CustomerImage)
                .HasForeignKey<CustomerImage>(d => d.CustomerId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_CustomerImages_Customers");

            entity.HasOne(d => d.Image).WithOne(p => p.CustomerImage)
                .HasForeignKey<CustomerImage>(d => d.ImageId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_CustomerImages_Images");

            entity.HasOne(d => d.Tenant).WithMany(p => p.CustomerImages)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_CustomerImages_Tenants");
        });

        modelBuilder.Entity<DiscountedProductPromotion>(entity =>
        {
            entity.HasIndex(e => e.ProductId, "IX_DiscountedProductPromotions_ProductId");

            entity.HasIndex(e => new { e.PromotionId, e.ProductId }, "UX_DiscountedProductPromotions_Promotion_Product").IsUnique();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_DiscountedProductPromotions_Id");
            entity.Property(e => e.FixedPrice).HasColumnType("decimal(10, 2)");
            entity.Property(e => e.PercentOff).HasColumnType("decimal(5, 2)");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_DiscountedProductPromotions_TenantId");

            entity.HasOne(d => d.Product).WithMany(p => p.DiscountedProductPromotions)
                .HasForeignKey(d => d.ProductId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_DiscountedProductPromotions_Products");

            entity.HasOne(d => d.Promotion).WithMany(p => p.DiscountedProductPromotions)
                .HasForeignKey(d => d.PromotionId)
                .HasConstraintName("FK_DiscountedProductPromotions_Promotions");

            entity.HasOne(d => d.Tenant).WithMany(p => p.DiscountedProductPromotions)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_DiscountedProductPromotions_Tenants");
        });

        modelBuilder.Entity<DiscountedProductPromotionAddOn>(entity =>
        {
            entity.HasIndex(e => e.AddOnProductId, "IX_DiscountedProductPromotionAddOns_AddOnProductId");

            entity.HasIndex(e => new { e.DiscountedProductPromotionId, e.AddOnProductId }, "IX_DiscountedProductPromotionAddOns_Promotion_AddOn").IsUnique();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_DiscountedProductPromotionAddOns_Id");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_DiscountedProductPromotionAddOns_TenantId");

            entity.HasOne(d => d.AddOnProduct).WithMany(p => p.DiscountedProductPromotionAddOns)
                .HasForeignKey(d => d.AddOnProductId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_DiscountedProductPromotionAddOns_Product");

            entity.HasOne(d => d.DiscountedProductPromotion).WithMany(p => p.DiscountedProductPromotionAddOns)
                .HasForeignKey(d => d.DiscountedProductPromotionId)
                .HasConstraintName("FK_DiscountedProductPromotionAddOns_Promotion");

            entity.HasOne(d => d.Tenant).WithMany(p => p.DiscountedProductPromotionAddOns)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_DiscountedProductPromotionAddOns_Tenants");
        });

        modelBuilder.Entity<Expense>(entity =>
        {
            entity.HasIndex(e => new { e.ExpenseDate, e.Category }, "IX_Expenses_ExpenseDate").IsDescending(true, false);

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_Expenses_Id");
            entity.Property(e => e.Amount).HasColumnType("decimal(18, 2)");
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("(getutcdate())", "DF_Expenses_CreatedAt");
            entity.Property(e => e.IsActive).HasDefaultValue(true, "DF_Expenses_IsActive");
            entity.Property(e => e.Note).HasMaxLength(200);
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_Expenses_TenantId");

            entity.HasOne(d => d.CreatedByNavigation).WithMany(p => p.ExpenseCreatedByNavigations)
                .HasForeignKey(d => d.CreatedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Expenses_CreatedBy");

            entity.HasOne(d => d.Tenant).WithMany(p => p.Expenses)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Expenses_Tenants");

            entity.HasOne(d => d.UpdatedByNavigation).WithMany(p => p.ExpenseUpdatedByNavigations)
                .HasForeignKey(d => d.UpdatedBy)
                .HasConstraintName("FK_Expenses_UpdatedBy");
        });

        modelBuilder.Entity<FixedBundlePromotion>(entity =>
        {
            entity.HasKey(e => e.PromotionId);

            entity.Property(e => e.PromotionId).ValueGeneratedNever();
            entity.Property(e => e.BundlePrice).HasColumnType("decimal(10, 2)");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_FixedBundlePromotions_TenantId");

            entity.HasOne(d => d.Promotion).WithOne(p => p.FixedBundlePromotion)
                .HasForeignKey<FixedBundlePromotion>(d => d.PromotionId)
                .HasConstraintName("FK_FixedBundlePromotions_Promotions");

            entity.HasOne(d => d.Tenant).WithMany(p => p.FixedBundlePromotions)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_FixedBundlePromotions_Tenants");
        });

        modelBuilder.Entity<FixedBundlePromotionItem>(entity =>
        {
            entity.HasIndex(e => e.ProductId, "IX_FixedBundlePromotionItems_ProductId");

            entity.HasIndex(e => new { e.FixedBundlePromotionId, e.ProductId }, "IX_FixedBundlePromotionItems_Promotion_Product").IsUnique();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_FixedBundlePromotionItems_Id");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_FixedBundlePromotionItems_TenantId");

            entity.HasOne(d => d.FixedBundlePromotion).WithMany(p => p.FixedBundlePromotionItems)
                .HasForeignKey(d => d.FixedBundlePromotionId)
                .HasConstraintName("FK_FixedBundlePromotionItems_FixedBundlePromotions");

            entity.HasOne(d => d.Product).WithMany(p => p.FixedBundlePromotionItems)
                .HasForeignKey(d => d.ProductId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_FixedBundlePromotionItems_Products");

            entity.HasOne(d => d.Tenant).WithMany(p => p.FixedBundlePromotionItems)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_FixedBundlePromotionItems_Tenants");
        });

        modelBuilder.Entity<FixedBundlePromotionItemAddOn>(entity =>
        {
            entity.HasIndex(e => new { e.FixedBundlePromotionItemId, e.AddOnProductId }, "IX_FixedBundlePromotionItemAddOns_Item_AddOn").IsUnique();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_FixedBundlePromotionItemAddOns_Id");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_FixedBundlePromotionItemAddOns_TenantId");

            entity.HasOne(d => d.AddOnProduct).WithMany(p => p.FixedBundlePromotionItemAddOns)
                .HasForeignKey(d => d.AddOnProductId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_FixedBundlePromotionItemAddOns_Product");

            entity.HasOne(d => d.FixedBundlePromotionItem).WithMany(p => p.FixedBundlePromotionItemAddOns)
                .HasForeignKey(d => d.FixedBundlePromotionItemId)
                .HasConstraintName("FK_FixedBundlePromotionItemAddOns_Item");

            entity.HasOne(d => d.Tenant).WithMany(p => p.FixedBundlePromotionItemAddOns)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_FixedBundlePromotionItemAddOns_Tenants");
        });

        modelBuilder.Entity<Image>(entity =>
        {
            entity.Property(e => e.ImageId).HasDefaultValueSql("(newid())");
            entity.Property(e => e.ImageUrl).HasMaxLength(512);
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_Images_TenantId");
            entity.Property(e => e.UploadedAt).HasDefaultValueSql("(sysdatetime())");

            entity.HasOne(d => d.Tenant).WithMany(p => p.Images)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Images_Tenants");
        });

        modelBuilder.Entity<Item>(entity =>
        {
            entity.HasIndex(e => e.IsActive, "IX_Items_IsActive");

            entity.HasIndex(e => e.Name, "IX_Items_Name");

            entity.HasIndex(e => e.TenantId, "IX_Items_TenantId");

            entity.HasIndex(e => new { e.TenantId, e.Barcode }, "UX_Items_Barcode")
                .IsUnique()
                .HasFilter("([Barcode] IS NOT NULL)");

            entity.HasIndex(e => new { e.TenantId, e.Sku }, "UX_Items_Sku")
                .IsUnique()
                .HasFilter("([Sku] IS NOT NULL)");

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_Items_Id");
            entity.Property(e => e.AllowNegativeStock).HasDefaultValue(true, "DF_Items_AllowNegativeStock");
            entity.Property(e => e.AverageCost).HasColumnType("decimal(18, 6)");
            entity.Property(e => e.Barcode).HasMaxLength(100);
            entity.Property(e => e.CostPrice).HasColumnType("decimal(18, 6)");
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("(getutcdate())", "DF_Items_CreatedAt");
            entity.Property(e => e.CriticalQuantity).HasColumnType("decimal(18, 3)");
            entity.Property(e => e.CurrentQuantity).HasColumnType("decimal(18, 3)");
            entity.Property(e => e.IsActive).HasDefaultValue(true, "DF_Items_IsActive");
            entity.Property(e => e.Name).HasMaxLength(100);
            entity.Property(e => e.ParLevel).HasColumnType("decimal(18, 3)");
            entity.Property(e => e.Sku).HasMaxLength(50);
            entity.Property(e => e.StockUnitName).HasMaxLength(30);
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_Items_TenantId");
            entity.Property(e => e.UnitName)
                .HasMaxLength(30)
                .HasDefaultValue("piece", "DF_Items_UnitName");
            entity.Property(e => e.UnitsPerStockUnit).HasColumnType("decimal(18, 3)");
            entity.Property(e => e.WarningQuantity).HasColumnType("decimal(18, 3)");
            entity.Property(e => e.WasteApprovalLimit).HasColumnType("decimal(18, 3)");
            entity.Property(e => e.YieldPercent)
                .HasDefaultValue(100m, "DF_Items_YieldPercent")
                .HasColumnType("decimal(5, 2)");

            entity.HasOne(d => d.CreatedByNavigation).WithMany(p => p.ItemCreatedByNavigations)
                .HasForeignKey(d => d.CreatedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Items_CreatedBy");

            entity.HasOne(d => d.Tenant).WithMany(p => p.Items)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Items_Tenants");

            entity.HasOne(d => d.UpdatedByNavigation).WithMany(p => p.ItemUpdatedByNavigations)
                .HasForeignKey(d => d.UpdatedBy)
                .HasConstraintName("FK_Items_UpdatedBy");
        });

        modelBuilder.Entity<ItemAlertRecipient>(entity =>
        {
            entity.HasIndex(e => new { e.ItemId, e.UserId }, "UX_ItemAlertRecipients_Item_User").IsUnique();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_ItemAlertRecipients_Id");
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("(getutcdate())", "DF_ItemAlertRecipients_CreatedAt");
            entity.Property(e => e.IsActive).HasDefaultValue(true, "DF_ItemAlertRecipients_IsActive");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_ItemAlertRecipients_TenantId");

            entity.HasOne(d => d.CreatedByNavigation).WithMany(p => p.ItemAlertRecipientCreatedByNavigations)
                .HasForeignKey(d => d.CreatedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ItemAlertRecipients_CreatedBy");

            entity.HasOne(d => d.Item).WithMany(p => p.ItemAlertRecipients)
                .HasForeignKey(d => d.ItemId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ItemAlertRecipients_Items");

            entity.HasOne(d => d.Tenant).WithMany(p => p.ItemAlertRecipients)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ItemAlertRecipients_Tenants");

            entity.HasOne(d => d.User).WithMany(p => p.ItemAlertRecipientUsers)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ItemAlertRecipients_Users");
        });

        modelBuilder.Entity<ItemPriceHistory>(entity =>
        {
            entity.ToTable("ItemPriceHistory");

            entity.HasIndex(e => e.ItemId, "IX_ItemPriceHistory_ItemId");

            entity.HasIndex(e => e.UpdatedAt, "IX_ItemPriceHistory_UpdatedAt").IsDescending();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_ItemPriceHistory_Id");
            entity.Property(e => e.NewPrice).HasColumnType("decimal(18, 6)");
            entity.Property(e => e.OldPrice).HasColumnType("decimal(18, 6)");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_ItemPriceHistory_TenantId");
            entity.Property(e => e.UpdatedAt)
                .HasDefaultValueSql("(getutcdate())", "DF_ItemPriceHistory_UpdatedAt")
                .HasColumnType("datetime");

            entity.HasOne(d => d.Item).WithMany(p => p.ItemPriceHistories)
                .HasForeignKey(d => d.ItemId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ItemPriceHistory_Item");

            entity.HasOne(d => d.Tenant).WithMany(p => p.ItemPriceHistories)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ItemPriceHistory_Tenants");

            entity.HasOne(d => d.UpdatedByNavigation).WithMany(p => p.ItemPriceHistories)
                .HasForeignKey(d => d.UpdatedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ItemPriceHistory_UpdatedBy");
        });

        modelBuilder.Entity<ItemSupplier>(entity =>
        {
            entity.HasIndex(e => e.SupplierId, "IX_ItemSuppliers_SupplierId");

            entity.HasIndex(e => new { e.ItemId, e.SupplierId }, "UX_ItemSuppliers_Item_Supplier").IsUnique();

            entity.HasIndex(e => new { e.ItemId, e.IsPreferred }, "UX_ItemSuppliers_Preferred")
                .IsUnique()
                .HasFilter("([IsPreferred]=(1))");

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_ItemSuppliers_Id");
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("(getutcdate())", "DF_ItemSuppliers_CreatedAt");
            entity.Property(e => e.PackName).HasMaxLength(50);
            entity.Property(e => e.PackPrice).HasColumnType("decimal(18, 2)");
            entity.Property(e => e.SupplierItemCode).HasMaxLength(50);
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_ItemSuppliers_TenantId");
            entity.Property(e => e.UnitsPerPack)
                .HasDefaultValue(1m, "DF_ItemSuppliers_UnitsPerPack")
                .HasColumnType("decimal(18, 3)");

            entity.HasOne(d => d.CreatedByNavigation).WithMany(p => p.ItemSupplierCreatedByNavigations)
                .HasForeignKey(d => d.CreatedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ItemSuppliers_CreatedBy");

            entity.HasOne(d => d.Item).WithMany(p => p.ItemSuppliers)
                .HasForeignKey(d => d.ItemId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ItemSuppliers_Item");

            entity.HasOne(d => d.Supplier).WithMany(p => p.ItemSuppliers)
                .HasForeignKey(d => d.SupplierId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ItemSuppliers_Supplier");

            entity.HasOne(d => d.Tenant).WithMany(p => p.ItemSuppliers)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ItemSuppliers_Tenants");

            entity.HasOne(d => d.UpdatedByNavigation).WithMany(p => p.ItemSupplierUpdatedByNavigations)
                .HasForeignKey(d => d.UpdatedBy)
                .HasConstraintName("FK_ItemSuppliers_UpdatedBy");
        });

        modelBuilder.Entity<ItemSupplierPriceHistory>(entity =>
        {
            entity.ToTable("ItemSupplierPriceHistory");

            entity.HasIndex(e => new { e.ItemSupplierId, e.ChangedAt }, "IX_ItemSupplierPriceHistory_ItemSupplier_ChangedAt").IsDescending(false, true);

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_ItemSupplierPriceHistory_Id");
            entity.Property(e => e.ChangedAt).HasDefaultValueSql("(getutcdate())", "DF_ItemSupplierPriceHistory_ChangedAt");
            entity.Property(e => e.NewPackPrice).HasColumnType("decimal(18, 2)");
            entity.Property(e => e.OldPackPrice).HasColumnType("decimal(18, 2)");
            entity.Property(e => e.Source)
                .HasMaxLength(20)
                .HasDefaultValue("Manual", "DF_ItemSupplierPriceHistory_Source");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_ItemSupplierPriceHistory_TenantId");

            entity.HasOne(d => d.ChangedByNavigation).WithMany(p => p.ItemSupplierPriceHistories)
                .HasForeignKey(d => d.ChangedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ItemSupplierPriceHistory_ChangedBy");

            entity.HasOne(d => d.ItemSupplier).WithMany(p => p.ItemSupplierPriceHistories)
                .HasForeignKey(d => d.ItemSupplierId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ItemSupplierPriceHistory_ItemSupplier");

            entity.HasOne(d => d.Tenant).WithMany(p => p.ItemSupplierPriceHistories)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ItemSupplierPriceHistory_Tenants");
        });

        modelBuilder.Entity<LoyaltyPoint>(entity =>
        {
            entity.HasIndex(e => e.TenantId, "IX_LoyaltyPoints_TenantId");

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_LoyaltyPoints_Id");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_LoyaltyPoints_TenantId");

            entity.HasOne(d => d.Customer).WithMany(p => p.LoyaltyPoints)
                .HasForeignKey(d => d.CustomerId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_LoyaltyPoints_Customers");

            entity.HasOne(d => d.Tenant).WithMany(p => p.LoyaltyPoints)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_LoyaltyPoints_Tenants");
        });

        modelBuilder.Entity<MixMatchPromotion>(entity =>
        {
            entity.HasKey(e => e.PromotionId);

            entity.Property(e => e.PromotionId).ValueGeneratedNever();
            entity.Property(e => e.BundlePrice).HasColumnType("decimal(10, 2)");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_MixMatchPromotions_TenantId");

            entity.HasOne(d => d.Promotion).WithOne(p => p.MixMatchPromotion)
                .HasForeignKey<MixMatchPromotion>(d => d.PromotionId)
                .HasConstraintName("FK_MixMatchPromotions_Promotions");

            entity.HasOne(d => d.Tenant).WithMany(p => p.MixMatchPromotions)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_MixMatchPromotions_Tenants");
        });

        modelBuilder.Entity<MixMatchPromotionProduct>(entity =>
        {
            entity.HasIndex(e => e.ProductId, "IX_MixMatchPromotionProducts_ProductId");

            entity.HasIndex(e => new { e.MixMatchPromotionId, e.ProductId }, "IX_MixMatchPromotionProducts_Promotion_Product").IsUnique();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_MixMatchPromotionProducts_Id");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_MixMatchPromotionProducts_TenantId");

            entity.HasOne(d => d.MixMatchPromotion).WithMany(p => p.MixMatchPromotionProducts)
                .HasForeignKey(d => d.MixMatchPromotionId)
                .HasConstraintName("FK_MixMatchPromotionProducts_MixMatchPromotions");

            entity.HasOne(d => d.Product).WithMany(p => p.MixMatchPromotionProducts)
                .HasForeignKey(d => d.ProductId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_MixMatchPromotionProducts_Products");

            entity.HasOne(d => d.Tenant).WithMany(p => p.MixMatchPromotionProducts)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_MixMatchPromotionProducts_Tenants");
        });

        modelBuilder.Entity<MixMatchPromotionProductAddOn>(entity =>
        {
            entity.HasIndex(e => new { e.MixMatchPromotionProductId, e.AddOnProductId }, "IX_MixMatchPromotionProductAddOns_Item_AddOn").IsUnique();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_MixMatchPromotionProductAddOns_Id");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_MixMatchPromotionProductAddOns_TenantId");

            entity.HasOne(d => d.AddOnProduct).WithMany(p => p.MixMatchPromotionProductAddOns)
                .HasForeignKey(d => d.AddOnProductId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_MixMatchPromotionProductAddOns_Product");

            entity.HasOne(d => d.MixMatchPromotionProduct).WithMany(p => p.MixMatchPromotionProductAddOns)
                .HasForeignKey(d => d.MixMatchPromotionProductId)
                .HasConstraintName("FK_MixMatchPromotionProductAddOns_Item");

            entity.HasOne(d => d.Tenant).WithMany(p => p.MixMatchPromotionProductAddOns)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_MixMatchPromotionProductAddOns_Tenants");
        });

        modelBuilder.Entity<Notification>(entity =>
        {
            entity.HasIndex(e => new { e.Kind, e.SubjectId, e.UserId, e.CreatedAt }, "IX_Notifications_Kind_Subject_User_Created").IsDescending(false, false, false, true);

            entity.HasIndex(e => e.TenantId, "IX_Notifications_TenantId");

            entity.HasIndex(e => new { e.UserId, e.Kind, e.ReadAt }, "IX_Notifications_User_Kind_Read");

            entity.HasIndex(e => new { e.UserId, e.ReadAt, e.CreatedAt }, "IX_Notifications_User_Read_Created").IsDescending(false, false, true);

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_Notifications_Id");
            entity.Property(e => e.Body).HasMaxLength(300);
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("(getutcdate())", "DF_Notifications_CreatedAt");
            entity.Property(e => e.Kind)
                .HasMaxLength(40)
                .IsUnicode(false)
                .HasDefaultValue("StockAlert", "DF_Notifications_Kind");
            entity.Property(e => e.Path).HasMaxLength(200);
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_Notifications_TenantId");
            entity.Property(e => e.Title).HasMaxLength(150);

            entity.HasOne(d => d.Tenant).WithMany(p => p.Notifications)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Notifications_Tenants");

            entity.HasOne(d => d.User).WithMany(p => p.Notifications)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Notifications_Users");
        });

        modelBuilder.Entity<Order>(entity =>
        {
            entity.HasIndex(e => e.CustomerId, "IX_Orders_CustomerId");

            entity.HasIndex(e => e.OrderLinkId, "IX_Orders_OrderLinkId");

            entity.HasIndex(e => e.StatusId, "IX_Orders_StatusId");

            entity.HasIndex(e => e.TenantId, "IX_Orders_TenantId");

            entity.HasIndex(e => new { e.TenantId, e.OrderNumber }, "UQ_Orders_OrderNumber").IsUnique();

            entity.HasIndex(e => new { e.TenantId, e.OfflineLocalId }, "UX_Orders_OfflineLocalId")
                .IsUnique()
                .HasFilter("([OfflineLocalId] IS NOT NULL)");

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())");
            entity.Property(e => e.AmountReceived).HasColumnType("decimal(10, 2)");
            entity.Property(e => e.ChangeAmount).HasColumnType("decimal(10, 2)");
            entity.Property(e => e.ContactNumber).HasMaxLength(30);
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("(getutcdate())")
                .HasColumnType("datetime");
            entity.Property(e => e.DeliveryAddress).HasMaxLength(300);
            entity.Property(e => e.Note).HasMaxLength(500);
            entity.Property(e => e.OfflineLocalId)
                .HasMaxLength(40)
                .IsUnicode(false);
            entity.Property(e => e.OrderNumber).HasDefaultValueSql("(NEXT VALUE FOR [dbo].[OrderNumberSeq])", "DF_Orders_OrderNumber_DEFAULT");
            entity.Property(e => e.OverrideReason).HasMaxLength(500);
            entity.Property(e => e.QuotedTotal).HasColumnType("decimal(18, 2)");
            entity.Property(e => e.RejectionReason).HasMaxLength(500);
            entity.Property(e => e.ReviewReasons).HasMaxLength(1000);
            entity.Property(e => e.SpecialInstructions)
                .HasMaxLength(100)
                .IsUnicode(false);
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_Orders_TenantId");
            entity.Property(e => e.Tips).HasColumnType("decimal(10, 2)");
            entity.Property(e => e.UpdatedAt).HasColumnType("datetime");

            entity.HasOne(d => d.CreatedByNavigation).WithMany(p => p.OrderCreatedByNavigations)
                .HasForeignKey(d => d.CreatedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Orders_CreatedBy");

            entity.HasOne(d => d.Customer).WithMany(p => p.Orders)
                .HasForeignKey(d => d.CustomerId)
                .HasConstraintName("FK_Orders_Customer");

            entity.HasOne(d => d.OrderLink).WithMany(p => p.Orders)
                .HasForeignKey(d => d.OrderLinkId)
                .HasConstraintName("FK_Orders_OrderLink");

            entity.HasOne(d => d.PaymentMethod).WithMany(p => p.Orders)
                .HasForeignKey(d => d.PaymentMethodId)
                .HasConstraintName("FK_Orders_PaymentMethods");

            entity.HasOne(d => d.Status).WithMany(p => p.Orders)
                .HasForeignKey(d => d.StatusId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Orders_Status");

            entity.HasOne(d => d.Tenant).WithMany(p => p.Orders)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Orders_Tenants");

            entity.HasOne(d => d.UpdatedByNavigation).WithMany(p => p.OrderUpdatedByNavigations)
                .HasForeignKey(d => d.UpdatedBy)
                .HasConstraintName("FK_Orders_UpdatedBy");
        });

        modelBuilder.Entity<OrderBundlePromotion>(entity =>
        {
            entity.HasIndex(e => e.OrderId, "IX_OrderBundlePromotions_OrderId");

            entity.HasIndex(e => e.PromotionId, "IX_OrderBundlePromotions_PromotionId");

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_OrderBundlePromotions_Id");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_OrderBundlePromotions_TenantId");
            entity.Property(e => e.UnitPrice).HasColumnType("decimal(10, 2)");

            entity.HasOne(d => d.Order).WithMany(p => p.OrderBundlePromotions)
                .HasForeignKey(d => d.OrderId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_OrderBundlePromotions_Order");

            entity.HasOne(d => d.Promotion).WithMany(p => p.OrderBundlePromotions)
                .HasForeignKey(d => d.PromotionId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_OrderBundlePromotions_Promotion");

            entity.HasOne(d => d.Tenant).WithMany(p => p.OrderBundlePromotions)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_OrderBundlePromotions_Tenants");
        });

        modelBuilder.Entity<OrderSeniorPwdDiscount>(entity =>
        {
            entity.HasIndex(e => e.OrderId, "IX_OrderSeniorPwdDiscounts_OrderId");

            entity.HasIndex(e => new { e.TenantId, e.IdNumber, e.CreatedAt }, "IX_OrderSeniorPwdDiscounts_TenantId_IdNumber_CreatedAt");

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_OrderSeniorPwdDiscounts_Id");
            entity.Property(e => e.CoveredAmount).HasColumnType("decimal(10, 2)");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("(getutcdate())", "DF_OrderSeniorPwdDiscounts_CreatedAt")
                .HasColumnType("datetime2(7)");
            entity.Property(e => e.CustomerName).HasMaxLength(100);
            entity.Property(e => e.DiscountAmount).HasColumnType("decimal(10, 2)");
            entity.Property(e => e.IdNumber).HasMaxLength(50);
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_OrderSeniorPwdDiscounts_TenantId");
            entity.Property(e => e.VatExemptAmount).HasColumnType("decimal(10, 2)");

            entity.HasOne(d => d.Order).WithMany(p => p.OrderSeniorPwdDiscounts)
                .HasForeignKey(d => d.OrderId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_OrderSeniorPwdDiscounts_Order");

            entity.HasOne(d => d.RecordedByNavigation).WithMany(p => p.OrderSeniorPwdDiscounts)
                .HasForeignKey(d => d.RecordedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_OrderSeniorPwdDiscounts_RecordedBy");

            entity.HasOne(d => d.Tenant).WithMany(p => p.OrderSeniorPwdDiscounts)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_OrderSeniorPwdDiscounts_Tenants");
        });

        modelBuilder.Entity<OrderItem>(entity =>
        {
            entity.HasIndex(e => e.BundlePromotionId, "IX_OrderItems_BundlePromotionId");

            entity.HasIndex(e => e.DiscountPromotionId, "IX_OrderItems_DiscountPromotionId").HasFilter("([DiscountPromotionId] IS NOT NULL)");

            entity.HasIndex(e => e.OrderId, "IX_OrderItems_OrderId");

            entity.HasIndex(e => new { e.OrderId, e.SortOrder }, "IX_OrderItems_OrderId_SortOrder");

            entity.HasIndex(e => e.ParentOrderItemId, "IX_OrderItems_ParentOrderItemId");

            entity.HasIndex(e => e.SeniorPwdDiscountId, "IX_OrderItems_SeniorPwdDiscountId").HasFilter("([SeniorPwdDiscountId] IS NOT NULL)");

            entity.HasIndex(e => e.ProductId, "IX_OrderItems_ProductId");

            entity.HasIndex(e => e.TenantId, "IX_OrderItems_TenantId");

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())");
            entity.Property(e => e.OriginalPrice).HasColumnType("decimal(10, 2)");
            entity.Property(e => e.Price).HasColumnType("decimal(10, 2)");
            entity.Property(e => e.PromoLabel).HasMaxLength(100);
            entity.Property(e => e.Quantity).HasDefaultValue(1);
            entity.Property(e => e.SeniorPwdDiscount).HasColumnType("decimal(10, 2)");
            entity.Property(e => e.SeniorPwdVatExempt).HasColumnType("decimal(10, 2)");
            entity.Property(e => e.SpecialInstructions)
                .HasMaxLength(100)
                .IsUnicode(false);
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_OrderItems_TenantId");

            entity.HasOne(d => d.BundlePromotion).WithMany(p => p.OrderItemBundlePromotions)
                .HasForeignKey(d => d.BundlePromotionId)
                .HasConstraintName("FK_OrderItems_BundlePromotion");

            entity.HasOne(d => d.DiscountPromotion).WithMany(p => p.OrderItemDiscountPromotions)
                .HasForeignKey(d => d.DiscountPromotionId)
                .HasConstraintName("FK_OrderItems_DiscountPromotion");

            entity.HasOne(d => d.Order).WithMany(p => p.OrderItems)
                .HasForeignKey(d => d.OrderId)
                .HasConstraintName("FK_OrderItems_Order");

            entity.HasOne(d => d.ParentOrderItem).WithMany(p => p.InverseParentOrderItem)
                .HasForeignKey(d => d.ParentOrderItemId)
                .HasConstraintName("FK_OrderItems_ParentOrderItem");

            entity.HasOne(d => d.SeniorPwdDiscountNavigation).WithMany(p => p.OrderItems)
                .HasForeignKey(d => d.SeniorPwdDiscountId)
                .HasConstraintName("FK_OrderItems_SeniorPwdDiscount");

            entity.HasOne(d => d.Product).WithMany(p => p.OrderItems)
                .HasForeignKey(d => d.ProductId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_OrderItems_Product");

            entity.HasOne(d => d.Tenant).WithMany(p => p.OrderItems)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_OrderItems_Tenants");
        });

        modelBuilder.Entity<PaymentMethod>(entity =>
        {
            entity.HasIndex(e => e.Name, "UQ_PaymentMethods_Name").IsUnique();

            entity.Property(e => e.Name)
                .HasMaxLength(30)
                .IsUnicode(false);
        });

        modelBuilder.Entity<Plan>(entity =>
        {
            entity.HasIndex(e => e.Code, "UX_Plans_Code").IsUnique();

            entity.Property(e => e.Code)
                .HasMaxLength(30)
                .IsUnicode(false);
            entity.Property(e => e.Features)
                .HasMaxLength(500)
                .IsUnicode(false)
                .HasDefaultValue("", "DF_Plans_Features");
            entity.Property(e => e.IsActive).HasDefaultValue(true, "DF_Plans_IsActive");
            entity.Property(e => e.MonthlyPrice).HasColumnType("decimal(10, 2)");
            entity.Property(e => e.Name).HasMaxLength(60);
        });

        modelBuilder.Entity<PlatformAdmin>(entity =>
        {
            entity.HasIndex(e => e.Username, "UQ_PlatformAdmins_Username").IsUnique();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_PlatformAdmins_Id");
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("(sysutcdatetime())", "DF_PlatformAdmins_CreatedAt");
            entity.Property(e => e.IsActive).HasDefaultValue(true, "DF_PlatformAdmins_IsActive");
            entity.Property(e => e.PasswordHash).HasMaxLength(200);
            entity.Property(e => e.Username)
                .HasMaxLength(50)
                .IsUnicode(false);
        });

        modelBuilder.Entity<PlatformAuditLog>(entity =>
        {
            entity.ToTable("PlatformAuditLog");

            entity.HasIndex(e => e.TenantId, "IX_PlatformAuditLog_TenantId");

            entity.HasIndex(e => e.Timestamp, "IX_PlatformAuditLog_Timestamp").IsDescending();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_PlatformAuditLog_Id");
            entity.Property(e => e.Action)
                .HasMaxLength(50)
                .IsUnicode(false);
            entity.Property(e => e.Details).HasMaxLength(2000);
            entity.Property(e => e.IpAddress)
                .HasMaxLength(64)
                .IsUnicode(false);
            entity.Property(e => e.Timestamp).HasDefaultValueSql("(sysutcdatetime())", "DF_PlatformAuditLog_Timestamp");
            entity.Property(e => e.Username)
                .HasMaxLength(50)
                .IsUnicode(false);
        });

        modelBuilder.Entity<Product>(entity =>
        {
            entity.HasIndex(e => e.CategoryId, "IX_Products_CategoryId");

            entity.HasIndex(e => e.CreatedBy, "IX_Products_CreatedBy");

            entity.HasIndex(e => e.IsAddOn, "IX_Products_IsAddOn");

            entity.HasIndex(e => e.TenantId, "IX_Products_TenantId");

            entity.HasIndex(e => new { e.TenantId, e.Code }, "UX_Products_Code").IsUnique();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())");
            entity.Property(e => e.Code).HasMaxLength(10);
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("(getutcdate())")
                .HasColumnType("datetime");
            entity.Property(e => e.Description).HasMaxLength(500);
            entity.Property(e => e.IsActive).HasDefaultValue(true);
            entity.Property(e => e.IsSeniorPwdEligible)
                .HasDefaultValue(true, "DF_Products_IsSeniorPwdEligible");
            entity.Property(e => e.Name)
                .HasMaxLength(100)
                .IsUnicode(false);
            entity.Property(e => e.Price).HasColumnType("decimal(10, 2)");
            entity.Property(e => e.SuppliesCost).HasColumnType("decimal(18, 6)");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_Products_TenantId");
            entity.Property(e => e.UpdatedAt).HasColumnType("datetime");

            entity.HasOne(d => d.Category).WithMany(p => p.Products)
                .HasForeignKey(d => d.CategoryId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Products_ProductCategories");

            entity.HasOne(d => d.CreatedByNavigation).WithMany(p => p.ProductCreatedByNavigations)
                .HasForeignKey(d => d.CreatedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Products_CreatedBy");

            entity.HasOne(d => d.SubCategory).WithMany(p => p.Products)
                .HasForeignKey(d => d.SubCategoryId)
                .HasConstraintName("FK_Products_ProductSubCategories");

            entity.HasOne(d => d.Tenant).WithMany(p => p.Products)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Products_Tenants");

            entity.HasOne(d => d.UpdatedByNavigation).WithMany(p => p.ProductUpdatedByNavigations)
                .HasForeignKey(d => d.UpdatedBy)
                .HasConstraintName("FK_Products_UpdatedBy");
        });

        modelBuilder.Entity<ProductAddOn>(entity =>
        {
            entity.HasKey(e => new { e.ProductId, e.AddOnId });

            entity.HasIndex(e => e.AddOnId, "IX_ProductAddOns_AddOnId");

            entity.Property(e => e.IsActive).HasDefaultValue(true, "DF_ProductAddOns_IsActive");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_ProductAddOns_TenantId");

            entity.HasOne(d => d.AddOn).WithMany(p => p.ProductAddOnAddOns)
                .HasForeignKey(d => d.AddOnId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ProductAddOns_AddOn");

            entity.HasOne(d => d.AddOnType).WithMany(p => p.ProductAddOns)
                .HasForeignKey(d => d.AddOnTypeId)
                .HasConstraintName("FK_ProductAddOns_AddOnType");

            entity.HasOne(d => d.Product).WithMany(p => p.ProductAddOnProducts)
                .HasForeignKey(d => d.ProductId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ProductAddOns_Product");

            entity.HasOne(d => d.Tenant).WithMany(p => p.ProductAddOns)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ProductAddOns_Tenants");
        });

        modelBuilder.Entity<ProductAddOnPriceOverride>(entity =>
        {
            entity.HasIndex(e => e.AddOnId, "IX_ProductAddOnPriceOverrides_AddOnId");

            entity.HasIndex(e => e.ProductId, "IX_ProductAddOnPriceOverrides_ProductId");

            entity.HasIndex(e => new { e.ProductId, e.AddOnId }, "UX_ProductAddOnPriceOverrides_Product_AddOn").IsUnique();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_ProductAddOnPriceOverrides_Id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("(getutcdate())", "DF_ProductAddOnPriceOverrides_CreatedAt")
                .HasColumnType("datetime");
            entity.Property(e => e.IsActive).HasDefaultValue(true, "DF_ProductAddOnPriceOverrides_IsActive");
            entity.Property(e => e.Price).HasColumnType("decimal(10, 2)");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_ProductAddOnPriceOverrides_TenantId");
            entity.Property(e => e.UpdatedAt).HasColumnType("datetime");

            entity.HasOne(d => d.Tenant).WithMany(p => p.ProductAddOnPriceOverrides)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ProductAddOnPriceOverrides_Tenants");

            entity.HasOne(d => d.ProductAddOn).WithOne(p => p.ProductAddOnPriceOverride)
                .HasForeignKey<ProductAddOnPriceOverride>(d => new { d.ProductId, d.AddOnId })
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ProductAddOnPriceOverrides_ProductAddOn");
        });

        modelBuilder.Entity<ProductCategory>(entity =>
        {
            entity.Property(e => e.Id).ValueGeneratedNever();
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("(sysutcdatetime())", "DF_ProductCategories_CreatedAt");
            entity.Property(e => e.IsActive).HasDefaultValue(true, "DF_ProductCategories_IsActive");
            entity.Property(e => e.Name)
                .HasMaxLength(50)
                .IsUnicode(false);
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_ProductCategories_TenantId");

            entity.HasOne(d => d.Tenant).WithMany(p => p.ProductCategories)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ProductCategories_Tenants");
        });

        modelBuilder.Entity<ProductImage>(entity =>
        {
            entity.HasKey(e => new { e.ProductId, e.ImageId });

            entity.HasIndex(e => e.ImageId, "UQ_ProductImages_ImageId").IsUnique();

            entity.HasIndex(e => e.ProductId, "UQ_ProductImages_ProductId").IsUnique();

            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_ProductImages_TenantId");

            entity.HasOne(d => d.Image).WithOne(p => p.ProductImage)
                .HasForeignKey<ProductImage>(d => d.ImageId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ProductImages_Images");

            entity.HasOne(d => d.Product).WithOne(p => p.ProductImage)
                .HasForeignKey<ProductImage>(d => d.ProductId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ProductImages_Products");

            entity.HasOne(d => d.Tenant).WithMany(p => p.ProductImages)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ProductImages_Tenants");
        });

        modelBuilder.Entity<ProductItemLink>(entity =>
        {
            entity.HasIndex(e => e.ItemId, "IX_ProductItemLinks_ItemId");

            entity.HasIndex(e => e.ProductId, "IX_ProductItemLinks_ProductId");

            entity.HasIndex(e => new { e.ProductId, e.ItemId }, "UX_ProductItemLinks_Product_Item").IsUnique();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_ProductItemLinks_Id");
            entity.Property(e => e.AllowancePercent).HasColumnType("decimal(5, 2)");
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("(getutcdate())", "DF_ProductItemLinks_CreatedAt");
            entity.Property(e => e.IsActive).HasDefaultValue(true, "DF_ProductItemLinks_IsActive");
            entity.Property(e => e.QuantityPerSale)
                .HasDefaultValue(1m, "DF_ProductItemLinks_QuantityPerSale")
                .HasColumnType("decimal(18, 3)");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_ProductItemLinks_TenantId");

            entity.HasOne(d => d.CreatedByNavigation).WithMany(p => p.ProductItemLinkCreatedByNavigations)
                .HasForeignKey(d => d.CreatedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ProductItemLinks_CreatedBy");

            entity.HasOne(d => d.Item).WithMany(p => p.ProductItemLinkItems)
                .HasForeignKey(d => d.ItemId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ProductItemLinks_Items");

            entity.HasOne(d => d.Product).WithMany(p => p.ProductItemLinks)
                .HasForeignKey(d => d.ProductId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ProductItemLinks_Products");

            entity.HasOne(d => d.ReplacesItem).WithMany(p => p.ProductItemLinkReplacesItems)
                .HasForeignKey(d => d.ReplacesItemId)
                .HasConstraintName("FK_ProductItemLinks_ReplacesItem");

            entity.HasOne(d => d.Tenant).WithMany(p => p.ProductItemLinks)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ProductItemLinks_Tenants");

            entity.HasOne(d => d.UpdatedByNavigation).WithMany(p => p.ProductItemLinkUpdatedByNavigations)
                .HasForeignKey(d => d.UpdatedBy)
                .HasConstraintName("FK_ProductItemLinks_UpdatedBy");
        });

        modelBuilder.Entity<ProductPriceHistory>(entity =>
        {
            entity.ToTable("ProductPriceHistory");

            entity.HasIndex(e => e.ProductId, "IX_ProductPriceHistory_ProductId");

            entity.HasIndex(e => e.UpdatedAt, "IX_ProductPriceHistory_UpdatedAt").IsDescending();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())");
            entity.Property(e => e.NewPrice).HasColumnType("decimal(10, 2)");
            entity.Property(e => e.OldPrice).HasColumnType("decimal(10, 2)");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_ProductPriceHistory_TenantId");
            entity.Property(e => e.UpdatedAt)
                .HasDefaultValueSql("(getutcdate())")
                .HasColumnType("datetime");

            entity.HasOne(d => d.Product).WithMany(p => p.ProductPriceHistories)
                .HasForeignKey(d => d.ProductId)
                .HasConstraintName("FK_ProductPriceHistory_Product");

            entity.HasOne(d => d.Tenant).WithMany(p => p.ProductPriceHistories)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ProductPriceHistory_Tenants");

            entity.HasOne(d => d.UpdatedByNavigation).WithMany(p => p.ProductPriceHistories)
                .HasForeignKey(d => d.UpdatedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ProductPriceHistory_UpdatedBy");
        });

        modelBuilder.Entity<ProductSizeAmount>(entity =>
        {
            entity.HasIndex(e => e.ItemId, "IX_ProductSizeAmounts_ItemId");

            entity.HasIndex(e => new { e.ProductId, e.SizeProductId, e.ItemId }, "UX_ProductSizeAmounts_Product_Size_Item").IsUnique();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_ProductSizeAmounts_Id");
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("(getutcdate())", "DF_ProductSizeAmounts_CreatedAt");
            entity.Property(e => e.IsActive).HasDefaultValue(true, "DF_ProductSizeAmounts_IsActive");
            entity.Property(e => e.Quantity).HasColumnType("decimal(18, 3)");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_ProductSizeAmounts_TenantId");

            entity.HasOne(d => d.CreatedByNavigation).WithMany(p => p.ProductSizeAmountCreatedByNavigations)
                .HasForeignKey(d => d.CreatedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ProductSizeAmounts_CreatedBy");

            entity.HasOne(d => d.Item).WithMany(p => p.ProductSizeAmounts)
                .HasForeignKey(d => d.ItemId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ProductSizeAmounts_Items");

            entity.HasOne(d => d.Product).WithMany(p => p.ProductSizeAmountProducts)
                .HasForeignKey(d => d.ProductId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ProductSizeAmounts_Products");

            entity.HasOne(d => d.SizeProduct).WithMany(p => p.ProductSizeAmountSizeProducts)
                .HasForeignKey(d => d.SizeProductId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ProductSizeAmounts_SizeProducts");

            entity.HasOne(d => d.Tenant).WithMany(p => p.ProductSizeAmounts)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ProductSizeAmounts_Tenants");

            entity.HasOne(d => d.UpdatedByNavigation).WithMany(p => p.ProductSizeAmountUpdatedByNavigations)
                .HasForeignKey(d => d.UpdatedBy)
                .HasConstraintName("FK_ProductSizeAmounts_UpdatedBy");
        });

        modelBuilder.Entity<ProductSubCategory>(entity =>
        {
            entity.Property(e => e.Id).ValueGeneratedNever();
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("(sysutcdatetime())", "DF_ProductSubCategories_CreatedAt");
            entity.Property(e => e.IsActive).HasDefaultValue(true, "DF_ProductSubCategories_IsActive");
            entity.Property(e => e.Name)
                .HasMaxLength(50)
                .IsUnicode(false);
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_ProductSubCategories_TenantId");

            entity.HasOne(d => d.Category).WithMany(p => p.ProductSubCategories)
                .HasForeignKey(d => d.CategoryId)
                .HasConstraintName("FK_ProductSubCategories_Category");

            entity.HasOne(d => d.Tenant).WithMany(p => p.ProductSubCategories)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ProductSubCategories_Tenants");
        });

        modelBuilder.Entity<Promotion>(entity =>
        {
            entity.HasIndex(e => e.CreatedBy, "IX_Promotions_CreatedBy");

            entity.HasIndex(e => new { e.TypeId, e.IsActive }, "IX_Promotions_TypeId_IsActive");

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_Promotions_Id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("(getutcdate())", "DF_Promotions_CreatedAt")
                .HasColumnType("datetime");
            entity.Property(e => e.EndTime).HasPrecision(0);
            entity.Property(e => e.IsActive).HasDefaultValue(true, "DF_Promotions_IsActive");
            entity.Property(e => e.Name).HasMaxLength(100);
            entity.Property(e => e.StartTime).HasPrecision(0);
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_Promotions_TenantId");
            entity.Property(e => e.UpdatedAt).HasColumnType("datetime");

            entity.HasOne(d => d.CreatedByNavigation).WithMany(p => p.PromotionCreatedByNavigations)
                .HasForeignKey(d => d.CreatedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Promotions_CreatedBy");

            entity.HasOne(d => d.Tenant).WithMany(p => p.Promotions)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Promotions_Tenants");

            entity.HasOne(d => d.UpdatedByNavigation).WithMany(p => p.PromotionUpdatedByNavigations)
                .HasForeignKey(d => d.UpdatedBy)
                .HasConstraintName("FK_Promotions_UpdatedBy");
        });

        modelBuilder.Entity<PromotionImage>(entity =>
        {
            entity.HasKey(e => new { e.PromotionId, e.ImageId });

            entity.HasIndex(e => e.ImageId, "UQ_PromotionImages_ImageId").IsUnique();

            entity.HasIndex(e => e.PromotionId, "UQ_PromotionImages_PromotionId").IsUnique();

            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_PromotionImages_TenantId");

            entity.HasOne(d => d.Image).WithOne(p => p.PromotionImage)
                .HasForeignKey<PromotionImage>(d => d.ImageId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_PromotionImages_Images");

            entity.HasOne(d => d.Promotion).WithOne(p => p.PromotionImage)
                .HasForeignKey<PromotionImage>(d => d.PromotionId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_PromotionImages_Promotions");

            entity.HasOne(d => d.Tenant).WithMany(p => p.PromotionImages)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_PromotionImages_Tenants");
        });

        modelBuilder.Entity<PurchaseOrder>(entity =>
        {
            entity.HasIndex(e => new { e.Status, e.CreatedAt }, "IX_PurchaseOrders_Status_CreatedAt").IsDescending(false, true);

            entity.HasIndex(e => e.SupplierId, "IX_PurchaseOrders_SupplierId");

            entity.HasIndex(e => new { e.TenantId, e.PoNumber }, "UX_PurchaseOrders_Tenant_PoNumber").IsUnique();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_PurchaseOrders_Id");
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("(getutcdate())", "DF_PurchaseOrders_CreatedAt");
            entity.Property(e => e.Note).HasMaxLength(500);
            entity.Property(e => e.Status).HasDefaultValue((byte)1, "DF_PurchaseOrders_Status");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_PurchaseOrders_TenantId");

            entity.HasOne(d => d.ClosedByNavigation).WithMany(p => p.PurchaseOrderClosedByNavigations)
                .HasForeignKey(d => d.ClosedBy)
                .HasConstraintName("FK_PurchaseOrders_ClosedBy");

            entity.HasOne(d => d.CreatedByNavigation).WithMany(p => p.PurchaseOrderCreatedByNavigations)
                .HasForeignKey(d => d.CreatedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_PurchaseOrders_CreatedBy");

            entity.HasOne(d => d.SentByNavigation).WithMany(p => p.PurchaseOrderSentByNavigations)
                .HasForeignKey(d => d.SentBy)
                .HasConstraintName("FK_PurchaseOrders_SentBy");

            entity.HasOne(d => d.Supplier).WithMany(p => p.PurchaseOrders)
                .HasForeignKey(d => d.SupplierId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_PurchaseOrders_Supplier");

            entity.HasOne(d => d.Tenant).WithMany(p => p.PurchaseOrders)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_PurchaseOrders_Tenants");
        });

        modelBuilder.Entity<PurchaseOrderLine>(entity =>
        {
            entity.HasIndex(e => e.ItemId, "IX_PurchaseOrderLines_Item");

            entity.HasIndex(e => new { e.PurchaseOrderId, e.ItemId }, "UX_PurchaseOrderLines_Order_Item").IsUnique();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_PurchaseOrderLines_Id");
            entity.Property(e => e.PackName).HasMaxLength(50);
            entity.Property(e => e.PackPrice).HasColumnType("decimal(18, 2)");
            entity.Property(e => e.PacksOrdered).HasColumnType("decimal(18, 3)");
            entity.Property(e => e.PacksReceived).HasColumnType("decimal(18, 3)");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_PurchaseOrderLines_TenantId");
            entity.Property(e => e.UnitsPerPack).HasColumnType("decimal(18, 3)");

            entity.HasOne(d => d.Item).WithMany(p => p.PurchaseOrderLines)
                .HasForeignKey(d => d.ItemId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_PurchaseOrderLines_Item");

            entity.HasOne(d => d.PurchaseOrder).WithMany(p => p.PurchaseOrderLines)
                .HasForeignKey(d => d.PurchaseOrderId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_PurchaseOrderLines_Order");

            entity.HasOne(d => d.Tenant).WithMany(p => p.PurchaseOrderLines)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_PurchaseOrderLines_Tenants");
        });

        modelBuilder.Entity<PushNotificationToken>(entity =>
        {
            entity.HasIndex(e => e.UserId, "IX_PushNotificationTokens_UserId");

            entity.HasIndex(e => e.Token, "UX_PushNotificationTokens_Token").IsUnique();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_PushNotificationTokens_Id");
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("(getutcdate())", "DF_PushNotificationTokens_CreatedAt");
            entity.Property(e => e.DeviceId).HasMaxLength(100);
            entity.Property(e => e.IsActive).HasDefaultValue(true, "DF_PushNotificationTokens_IsActive");
            entity.Property(e => e.LastSeenAt).HasDefaultValueSql("(getutcdate())", "DF_PushNotificationTokens_LastSeenAt");
            entity.Property(e => e.Platform).HasMaxLength(20);
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_PushNotificationTokens_TenantId");
            entity.Property(e => e.Token).HasMaxLength(512);

            entity.HasOne(d => d.Tenant).WithMany(p => p.PushNotificationTokens)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_PushNotificationTokens_Tenants");

            entity.HasOne(d => d.User).WithMany(p => p.PushNotificationTokens)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_PushNotificationTokens_Users");
        });

        modelBuilder.Entity<RefreshToken>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__RefreshT__F5845E59");

            entity.HasIndex(e => e.Token, "UQ__RefreshT__1EB4F816").IsUnique();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_RefreshTokens_Id");
            entity.Property(e => e.CreatedAt).HasColumnType("datetime");
            entity.Property(e => e.ExpiresAt).HasColumnType("datetime");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_RefreshTokens_TenantId");
            entity.Property(e => e.Token)
                .HasMaxLength(500)
                .IsUnicode(false);

            entity.HasOne(d => d.Tenant).WithMany(p => p.RefreshTokens)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_RefreshTokens_Tenants");

            entity.HasOne(d => d.User).WithMany(p => p.RefreshTokens)
                .HasForeignKey(d => d.UserId)
                .HasConstraintName("FK__RefreshTokens__Users");
        });

        modelBuilder.Entity<RolePermission>(entity =>
        {
            entity.HasKey(e => new { e.RoleId, e.PermissionKey });

            entity.Property(e => e.PermissionKey).HasMaxLength(100);

            entity.HasOne(d => d.Role).WithMany(p => p.RolePermissions)
                .HasForeignKey(d => d.RoleId)
                .HasConstraintName("FK_RolePermissions_UserRoles");
        });

        modelBuilder.Entity<SchemaScriptHistory>(entity =>
        {
            entity.ToTable("SchemaScriptHistory");

            entity.HasIndex(e => e.ScriptName, "UX_SchemaScriptHistory_ScriptName").IsUnique();

            entity.Property(e => e.AppliedAt).HasDefaultValueSql("(getutcdate())", "DF_SchemaScriptHistory_AppliedAt");
            entity.Property(e => e.ScriptName).HasMaxLength(260);
        });

        modelBuilder.Entity<ShortLink>(entity =>
        {
            entity.HasIndex(e => e.Token, "IX_ShortLinks").IsUnique();

            entity.HasIndex(e => e.CreatedBy, "IX_ShortLinks_CreatedBy");

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_ShortLinks_Id");
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("(sysutcdatetime())", "DF_ShortLinks_CreatedAt");
            entity.Property(e => e.TargetType)
                .HasMaxLength(50)
                .IsUnicode(false);
            entity.Property(e => e.TargetUrl).IsUnicode(false);
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_ShortLinks_TenantId");
            entity.Property(e => e.Token)
                .HasMaxLength(64)
                .IsUnicode(false);

            entity.HasOne(d => d.CreatedByNavigation).WithMany(p => p.ShortLinks)
                .HasForeignKey(d => d.CreatedBy)
                .HasConstraintName("FK_ShortLinks_CreatedBy");

            entity.HasOne(d => d.Tenant).WithMany(p => p.ShortLinks)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ShortLinks_Tenants");
        });

        modelBuilder.Entity<Status>(entity =>
        {
            entity.Property(e => e.Name)
                .HasMaxLength(30)
                .IsUnicode(false);
        });

        modelBuilder.Entity<StockCount>(entity =>
        {
            entity.HasIndex(e => new { e.Status, e.CreatedAt }, "IX_StockCounts_Status_CreatedAt").IsDescending(false, true);

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_StockCounts_Id");
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("(getutcdate())", "DF_StockCounts_CreatedAt");
            entity.Property(e => e.Name).HasMaxLength(100);
            entity.Property(e => e.Note).HasMaxLength(500);
            entity.Property(e => e.Status).HasDefaultValue((byte)1, "DF_StockCounts_Status");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_StockCounts_TenantId");

            entity.HasOne(d => d.CancelledByNavigation).WithMany(p => p.StockCountCancelledByNavigations)
                .HasForeignKey(d => d.CancelledBy)
                .HasConstraintName("FK_StockCounts_CancelledBy");

            entity.HasOne(d => d.CreatedByNavigation).WithMany(p => p.StockCountCreatedByNavigations)
                .HasForeignKey(d => d.CreatedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_StockCounts_CreatedBy");

            entity.HasOne(d => d.PostedByNavigation).WithMany(p => p.StockCountPostedByNavigations)
                .HasForeignKey(d => d.PostedBy)
                .HasConstraintName("FK_StockCounts_PostedBy");

            entity.HasOne(d => d.Tenant).WithMany(p => p.StockCounts)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_StockCounts_Tenants");
        });

        modelBuilder.Entity<StockCountLine>(entity =>
        {
            entity.HasIndex(e => new { e.CountId, e.ItemId }, "UQ_StockCountLines_CountItem").IsUnique();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_StockCountLines_Id");
            entity.Property(e => e.CountedQuantity).HasColumnType("decimal(18, 3)");
            entity.Property(e => e.ExpectedQuantity).HasColumnType("decimal(18, 3)");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_StockCountLines_TenantId");

            entity.HasOne(d => d.Count).WithMany(p => p.StockCountLines)
                .HasForeignKey(d => d.CountId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_StockCountLines_Count");

            entity.HasOne(d => d.CountedByNavigation).WithMany(p => p.StockCountLines)
                .HasForeignKey(d => d.CountedBy)
                .HasConstraintName("FK_StockCountLines_CountedBy");

            entity.HasOne(d => d.Item).WithMany(p => p.StockCountLines)
                .HasForeignKey(d => d.ItemId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_StockCountLines_Item");

            entity.HasOne(d => d.Tenant).WithMany(p => p.StockCountLines)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_StockCountLines_Tenants");
        });

        modelBuilder.Entity<StockMovement>(entity =>
        {
            entity.HasIndex(e => new { e.ItemId, e.CreatedAt }, "IX_StockMovements_ItemId_CreatedAt").IsDescending(false, true);

            entity.HasIndex(e => new { e.ReferenceType, e.ReferenceId }, "IX_StockMovements_Reference");

            entity.HasIndex(e => e.TenantId, "IX_StockMovements_TenantId");

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_StockMovements_Id");
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("(getutcdate())", "DF_StockMovements_CreatedAt");
            entity.Property(e => e.MovementType).HasMaxLength(30);
            entity.Property(e => e.Notes).HasMaxLength(500);
            entity.Property(e => e.QuantityAfter).HasColumnType("decimal(18, 3)");
            entity.Property(e => e.QuantityBefore).HasColumnType("decimal(18, 3)");
            entity.Property(e => e.QuantityDelta).HasColumnType("decimal(18, 3)");
            entity.Property(e => e.ReferenceType).HasMaxLength(30);
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_StockMovements_TenantId");
            entity.Property(e => e.UnitCost).HasColumnType("decimal(18, 6)");

            entity.HasOne(d => d.CreatedByNavigation).WithMany(p => p.StockMovements)
                .HasForeignKey(d => d.CreatedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_StockMovements_CreatedBy");

            entity.HasOne(d => d.Item).WithMany(p => p.StockMovements)
                .HasForeignKey(d => d.ItemId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_StockMovements_Items");

            entity.HasOne(d => d.Product).WithMany(p => p.StockMovements)
                .HasForeignKey(d => d.ProductId)
                .HasConstraintName("FK_StockMovements_Products");

            entity.HasOne(d => d.Tenant).WithMany(p => p.StockMovements)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_StockMovements_Tenants");
        });

        modelBuilder.Entity<StockReceipt>(entity =>
        {
            entity.HasIndex(e => e.PurchaseOrderId, "IX_StockReceipts_PurchaseOrderId").HasFilter("([PurchaseOrderId] IS NOT NULL)");

            entity.HasIndex(e => new { e.ReceivedOn, e.CreatedAt }, "IX_StockReceipts_ReceivedOn").IsDescending();

            entity.HasIndex(e => e.SupplierId, "IX_StockReceipts_SupplierId");

            entity.HasIndex(e => e.ClientRequestId, "UX_StockReceipts_ClientRequestId")
                .IsUnique()
                .HasFilter("([ClientRequestId] IS NOT NULL)");

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_StockReceipts_Id");
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("(getutcdate())", "DF_StockReceipts_CreatedAt");
            entity.Property(e => e.InvoiceNumber).HasMaxLength(50);
            entity.Property(e => e.InvoiceTotal).HasColumnType("decimal(18, 2)");
            entity.Property(e => e.Note).HasMaxLength(500);
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_StockReceipts_TenantId");

            entity.HasOne(d => d.CreatedByNavigation).WithMany(p => p.StockReceipts)
                .HasForeignKey(d => d.CreatedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_StockReceipts_CreatedBy");

            entity.HasOne(d => d.PurchaseOrder).WithMany(p => p.StockReceipts)
                .HasForeignKey(d => d.PurchaseOrderId)
                .HasConstraintName("FK_StockReceipts_PurchaseOrder");

            entity.HasOne(d => d.Supplier).WithMany(p => p.StockReceipts)
                .HasForeignKey(d => d.SupplierId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_StockReceipts_Supplier");

            entity.HasOne(d => d.Tenant).WithMany(p => p.StockReceipts)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_StockReceipts_Tenants");
        });

        modelBuilder.Entity<StockReceiptLine>(entity =>
        {
            entity.HasIndex(e => e.ItemId, "IX_StockReceiptLines_Item");

            entity.HasIndex(e => e.ReceiptId, "IX_StockReceiptLines_Receipt");

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_StockReceiptLines_Id");
            entity.Property(e => e.PackName).HasMaxLength(50);
            entity.Property(e => e.PackPrice).HasColumnType("decimal(18, 2)");
            entity.Property(e => e.Packs).HasColumnType("decimal(18, 3)");
            entity.Property(e => e.Quantity).HasColumnType("decimal(18, 3)");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_StockReceiptLines_TenantId");
            entity.Property(e => e.UnitCost).HasColumnType("decimal(18, 6)");
            entity.Property(e => e.UnitsPerPack).HasColumnType("decimal(18, 3)");

            entity.HasOne(d => d.Item).WithMany(p => p.StockReceiptLines)
                .HasForeignKey(d => d.ItemId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_StockReceiptLines_Item");

            entity.HasOne(d => d.Receipt).WithMany(p => p.StockReceiptLines)
                .HasForeignKey(d => d.ReceiptId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_StockReceiptLines_Receipt");

            entity.HasOne(d => d.Tenant).WithMany(p => p.StockReceiptLines)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_StockReceiptLines_Tenants");
        });

        modelBuilder.Entity<StockWaste>(entity =>
        {
            entity.HasIndex(e => e.CreatedAt, "IX_StockWastes_CreatedAt");

            entity.HasIndex(e => new { e.ItemId, e.CreatedAt }, "IX_StockWastes_Item_Created");

            entity.HasIndex(e => e.Status, "IX_StockWastes_Status");

            entity.HasIndex(e => e.ClientRequestId, "UX_StockWastes_ClientRequestId")
                .IsUnique()
                .HasFilter("([ClientRequestId] IS NOT NULL)");

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_StockWastes_Id");
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("(getutcdate())", "DF_StockWastes_CreatedAt");
            entity.Property(e => e.Notes).HasMaxLength(500);
            entity.Property(e => e.Quantity).HasColumnType("decimal(18, 3)");
            entity.Property(e => e.ReasonName).HasMaxLength(60);
            entity.Property(e => e.ReversalReason).HasMaxLength(500);
            entity.Property(e => e.ReviewNote).HasMaxLength(500);
            entity.Property(e => e.Source).HasDefaultValue((byte)1, "DF_StockWastes_Source");
            entity.Property(e => e.Status).HasDefaultValue((byte)1, "DF_StockWastes_Status");
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_StockWastes_TenantId");

            entity.HasOne(d => d.CreatedByNavigation).WithMany(p => p.StockWasteCreatedByNavigations)
                .HasForeignKey(d => d.CreatedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_StockWastes_CreatedBy");

            entity.HasOne(d => d.Item).WithMany(p => p.StockWastes)
                .HasForeignKey(d => d.ItemId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_StockWastes_Items");

            entity.HasOne(d => d.ReversalMovement).WithMany(p => p.StockWasteReversalMovements)
                .HasForeignKey(d => d.ReversalMovementId)
                .HasConstraintName("FK_StockWastes_ReversalMovement");

            entity.HasOne(d => d.ReversedByNavigation).WithMany(p => p.StockWasteReversedByNavigations)
                .HasForeignKey(d => d.ReversedBy)
                .HasConstraintName("FK_StockWastes_ReversedBy");

            entity.HasOne(d => d.ReviewedByNavigation).WithMany(p => p.StockWasteReviewedByNavigations)
                .HasForeignKey(d => d.ReviewedBy)
                .HasConstraintName("FK_StockWastes_ReviewedBy");

            entity.HasOne(d => d.StockMovement).WithMany(p => p.StockWasteStockMovements)
                .HasForeignKey(d => d.StockMovementId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_StockWastes_StockMovements");

            entity.HasOne(d => d.Tenant).WithMany(p => p.StockWastes)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_StockWastes_Tenants");

            entity.HasOne(d => d.WasteReason).WithMany(p => p.StockWastes)
                .HasForeignKey(d => d.WasteReasonId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_StockWastes_WasteReasons");
        });

        modelBuilder.Entity<Supplier>(entity =>
        {
            entity.HasIndex(e => new { e.TenantId, e.Name }, "UX_Suppliers_Name").IsUnique();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_Suppliers_Id");
            entity.Property(e => e.Address).HasMaxLength(300);
            entity.Property(e => e.ContactName).HasMaxLength(100);
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("(getutcdate())", "DF_Suppliers_CreatedAt");
            entity.Property(e => e.Email).HasMaxLength(150);
            entity.Property(e => e.IsActive).HasDefaultValue(true, "DF_Suppliers_IsActive");
            entity.Property(e => e.Name).HasMaxLength(100);
            entity.Property(e => e.Notes).HasMaxLength(500);
            entity.Property(e => e.PaymentTerms).HasMaxLength(100);
            entity.Property(e => e.Phone).HasMaxLength(30);
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_Suppliers_TenantId");

            entity.HasOne(d => d.CreatedByNavigation).WithMany(p => p.SupplierCreatedByNavigations)
                .HasForeignKey(d => d.CreatedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Suppliers_CreatedBy");

            entity.HasOne(d => d.Tenant).WithMany(p => p.Suppliers)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Suppliers_Tenants");

            entity.HasOne(d => d.UpdatedByNavigation).WithMany(p => p.SupplierUpdatedByNavigations)
                .HasForeignKey(d => d.UpdatedBy)
                .HasConstraintName("FK_Suppliers_UpdatedBy");
        });

        modelBuilder.Entity<Tenant>(entity =>
        {
            entity.HasIndex(e => e.Slug, "UX_Tenants_Slug").IsUnique();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_Tenants_Id");
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("(sysutcdatetime())", "DF_Tenants_CreatedAt");
            entity.Property(e => e.Name).HasMaxLength(100);
            entity.Property(e => e.Slug)
                .HasMaxLength(50)
                .IsUnicode(false);
            entity.Property(e => e.Status).HasDefaultValue((byte)2, "DF_Tenants_Status");
        });

        modelBuilder.Entity<TenantCounter>(entity =>
        {
            entity.HasKey(e => new { e.TenantId, e.Name });

            entity.Property(e => e.Name)
                .HasMaxLength(50)
                .IsUnicode(false);

            entity.HasOne(d => d.Tenant).WithMany(p => p.TenantCounters)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_TenantCounters_Tenants");
        });

        modelBuilder.Entity<TenantInvoice>(entity =>
        {
            entity.HasIndex(e => new { e.TenantId, e.CreatedAt }, "IX_TenantInvoices_TenantId_CreatedAt");

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_TenantInvoices_Id");
            entity.Property(e => e.Amount).HasColumnType("decimal(12, 2)");
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("(sysutcdatetime())", "DF_TenantInvoices_CreatedAt");
            entity.Property(e => e.Notes).HasMaxLength(500);
            entity.Property(e => e.Reference).HasMaxLength(100);
            entity.Property(e => e.Status).HasDefaultValue((byte)1, "DF_TenantInvoices_Status");

            entity.HasOne(d => d.Plan).WithMany(p => p.TenantInvoices)
                .HasForeignKey(d => d.PlanId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_TenantInvoices_Plans");

            entity.HasOne(d => d.Tenant).WithMany(p => p.TenantInvoices)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_TenantInvoices_Tenants");
        });

        modelBuilder.Entity<TenantSetting>(entity =>
        {
            entity.HasKey(e => e.TenantId);

            entity.Property(e => e.TenantId).ValueGeneratedNever();
            entity.Property(e => e.Address).HasMaxLength(300);
            entity.Property(e => e.CurrencyCode)
                .HasMaxLength(3)
                .IsUnicode(false)
                .HasDefaultValue("PHP", "DF_TenantSettings_CurrencyCode");
            entity.Property(e => e.CurrencyDecimals).HasDefaultValue(2, "DF_TenantSettings_CurrencyDecimals");
            entity.Property(e => e.CurrencySymbol)
                .HasMaxLength(8)
                .HasDefaultValueSql("(nchar((8369)))", "DF_TenantSettings_CurrencySymbol");
            entity.Property(e => e.Email).HasMaxLength(150);
            entity.Property(e => e.LogoUrl)
                .HasMaxLength(500)
                .IsUnicode(false);
            entity.Property(e => e.Phone).HasMaxLength(40);
            entity.Property(e => e.PrimaryColor)
                .HasMaxLength(9)
                .IsUnicode(false)
                .HasDefaultValue("#6f4e37", "DF_TenantSettings_PrimaryColor");
            entity.Property(e => e.ReceiptFooter).HasMaxLength(300);
            entity.Property(e => e.ReceiptHeader).HasMaxLength(300);
            entity.Property(e => e.RegistrationText).HasMaxLength(150);
            entity.Property(e => e.SeniorPwdEnabled).HasDefaultValue(false, "DF_TenantSettings_SeniorPwdEnabled");
            entity.Property(e => e.VatRegistered).HasDefaultValue(false, "DF_TenantSettings_VatRegistered");
            entity.Property(e => e.ShopName).HasMaxLength(100);
            entity.Property(e => e.ShortName).HasMaxLength(30);
            entity.Property(e => e.Tagline).HasMaxLength(150);
            entity.Property(e => e.TimeZone)
                .HasMaxLength(64)
                .IsUnicode(false)
                .HasDefaultValue("Asia/Manila", "DF_TenantSettings_TimeZone");

            entity.HasOne(d => d.Tenant).WithOne(p => p.TenantSetting)
                .HasForeignKey<TenantSetting>(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_TenantSettings_Tenants");
        });

        modelBuilder.Entity<TenantSubscription>(entity =>
        {
            entity.HasKey(e => e.TenantId);

            entity.Property(e => e.TenantId).ValueGeneratedNever();
            entity.Property(e => e.DiscountPercent).HasColumnType("decimal(5, 2)");
            entity.Property(e => e.GraceDays).HasDefaultValue(7, "DF_TenantSubscriptions_GraceDays");
            entity.Property(e => e.Notes).HasMaxLength(500);

            entity.HasOne(d => d.Plan).WithMany(p => p.TenantSubscriptions)
                .HasForeignKey(d => d.PlanId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_TenantSubscriptions_Plans");

            entity.HasOne(d => d.Tenant).WithOne(p => p.TenantSubscription)
                .HasForeignKey<TenantSubscription>(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_TenantSubscriptions_Tenants");
        });

        modelBuilder.Entity<TenantTombstone>(entity =>
        {
            entity.HasKey(e => e.TenantId);

            entity.Property(e => e.TenantId).ValueGeneratedNever();
            entity.Property(e => e.DeletedAt).HasDefaultValueSql("(sysutcdatetime())", "DF_TenantTombstones_DeletedAt");
            entity.Property(e => e.DeletedBy)
                .HasMaxLength(50)
                .IsUnicode(false);
            entity.Property(e => e.Name).HasMaxLength(100);
            entity.Property(e => e.Slug)
                .HasMaxLength(50)
                .IsUnicode(false);
        });

        modelBuilder.Entity<User>(entity =>
        {
            entity.HasIndex(e => e.CreatedBy, "IX_Users_CreatedBy");

            entity.HasIndex(e => e.RoleId, "IX_Users_RoleId");

            entity.HasIndex(e => e.Username, "UX_Users_Username").IsUnique();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_Users_Id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("(getutcdate())", "DF_Users_CreatedAt")
                .HasColumnType("datetime");
            entity.Property(e => e.FirstName)
                .HasMaxLength(50)
                .IsUnicode(false);
            entity.Property(e => e.IsActive).HasDefaultValue(true, "DF_Users_IsActive");
            entity.Property(e => e.LastName)
                .HasMaxLength(50)
                .IsUnicode(false);
            entity.Property(e => e.PasswordHash).IsUnicode(false);
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_Users_TenantId");
            entity.Property(e => e.UpdatedAt).HasColumnType("datetime");
            entity.Property(e => e.Username)
                .HasMaxLength(50)
                .IsUnicode(false);

            entity.HasOne(d => d.CreatedByNavigation).WithMany(p => p.InverseCreatedByNavigation)
                .HasForeignKey(d => d.CreatedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Users_CreatedBy");

            entity.HasOne(d => d.Role).WithMany(p => p.Users)
                .HasForeignKey(d => d.RoleId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Users_UserRoles");

            entity.HasOne(d => d.Tenant).WithMany(p => p.Users)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Users_Tenants");

            entity.HasOne(d => d.UpdatedByNavigation).WithMany(p => p.InverseUpdatedByNavigation)
                .HasForeignKey(d => d.UpdatedBy)
                .HasConstraintName("FK_Users_UpdatedBy");
        });

        modelBuilder.Entity<UserImage>(entity =>
        {
            entity.HasKey(e => new { e.UserId, e.ImageId }).HasName("PK_UserImage");

            entity.HasIndex(e => e.ImageId, "UQ_UserImage_ImageId").IsUnique();

            entity.HasIndex(e => e.UserId, "UQ_UserImage_UserId").IsUnique();

            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_UserImages_TenantId");

            entity.HasOne(d => d.Image).WithOne(p => p.UserImage)
                .HasForeignKey<UserImage>(d => d.ImageId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_UserImage_Images");

            entity.HasOne(d => d.Tenant).WithMany(p => p.UserImages)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_UserImages_Tenants");

            entity.HasOne(d => d.User).WithOne(p => p.UserImage)
                .HasForeignKey<UserImage>(d => d.UserId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_UserImage_Users");
        });

        modelBuilder.Entity<UserRole>(entity =>
        {
            entity.HasIndex(e => e.Name, "UX_UserRoles_SystemName")
                .IsUnique()
                .HasFilter("([TenantId] IS NULL)");

            entity.HasIndex(e => new { e.TenantId, e.Name }, "UX_UserRoles_TenantName")
                .IsUnique()
                .HasFilter("([TenantId] IS NOT NULL)");

            entity.Property(e => e.Id).ValueGeneratedNever();
            entity.Property(e => e.Description).HasMaxLength(200);
            entity.Property(e => e.Name).HasMaxLength(50);

            entity.HasOne(d => d.Tenant).WithMany(p => p.UserRoles)
                .HasForeignKey(d => d.TenantId)
                .HasConstraintName("FK_UserRoles_Tenants");
        });

        modelBuilder.Entity<WasteReason>(entity =>
        {
            entity.HasIndex(e => new { e.TenantId, e.Name }, "UX_WasteReasons_Name").IsUnique();

            entity.Property(e => e.CreatedAt).HasDefaultValueSql("(getutcdate())", "DF_WasteReasons_CreatedAt");
            entity.Property(e => e.IsActive).HasDefaultValue(true, "DF_WasteReasons_IsActive");
            entity.Property(e => e.Name).HasMaxLength(60);
            entity.Property(e => e.TenantId).HasDefaultValue(new Guid("00000000-0000-0000-0000-000000000001"), "DF_WasteReasons_TenantId");

            entity.HasOne(d => d.CreatedByNavigation).WithMany(p => p.WasteReasonCreatedByNavigations)
                .HasForeignKey(d => d.CreatedBy)
                .HasConstraintName("FK_WasteReasons_CreatedBy");

            entity.HasOne(d => d.Tenant).WithMany(p => p.WasteReasons)
                .HasForeignKey(d => d.TenantId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_WasteReasons_Tenants");

            entity.HasOne(d => d.UpdatedByNavigation).WithMany(p => p.WasteReasonUpdatedByNavigations)
                .HasForeignKey(d => d.UpdatedBy)
                .HasConstraintName("FK_WasteReasons_UpdatedBy");
        });
        modelBuilder.HasSequence("OrderNumberSeq");
        modelBuilder.HasSequence<int>("UserRoleIdSeq").StartsAt(100L);

        OnModelCreatingPartial(modelBuilder);
    }

    partial void OnModelCreatingPartial(ModelBuilder modelBuilder);
}
