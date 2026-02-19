using System;
using System.Collections.Generic;
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

    public virtual DbSet<Customer> Customers { get; set; }

    public virtual DbSet<CustomerImage> CustomerImages { get; set; }

    public virtual DbSet<Image> Images { get; set; }

    public virtual DbSet<LoyaltyPoint> LoyaltyPoints { get; set; }

    public virtual DbSet<Order> Orders { get; set; }

    public virtual DbSet<OrderItem> OrderItems { get; set; }

    public virtual DbSet<PaymentMethod> PaymentMethods { get; set; }

    public virtual DbSet<Product> Products { get; set; }

    public virtual DbSet<ProductAddOn> ProductAddOns { get; set; }

    public virtual DbSet<ProductAddOnPriceOverride> ProductAddOnPriceOverrides { get; set; }

    public virtual DbSet<ProductCategory> ProductCategories { get; set; }

    public virtual DbSet<ProductImage> ProductImages { get; set; }

    public virtual DbSet<ProductPriceHistory> ProductPriceHistories { get; set; }

    public virtual DbSet<RefreshToken> RefreshTokens { get; set; }

    public virtual DbSet<ShortLink> ShortLinks { get; set; }

    public virtual DbSet<Status> Statuses { get; set; }

    public virtual DbSet<User> Users { get; set; }

    public virtual DbSet<UserImage> UserImages { get; set; }

    public virtual DbSet<UserRole> UserRoles { get; set; }

    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
        => optionsBuilder.UseSqlServer("Name=ConnectionStrings:WtfDb");

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AddOnType>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__AddOnTyp__3214EC07C1575775");

            entity.ToTable("AddOnType");

            entity.Property(e => e.Id).ValueGeneratedNever();
            entity.Property(e => e.Name).HasMaxLength(50);
        });

        modelBuilder.Entity<Customer>(entity =>
        {
            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_Customers_Id");
            entity.Property(e => e.Address).IsUnicode(false);
            entity.Property(e => e.FirstName)
                .HasMaxLength(50)
                .IsUnicode(false);
            entity.Property(e => e.IsActive).HasDefaultValue(true, "DF_Customers_IsActive");
            entity.Property(e => e.LastName)
                .HasMaxLength(50)
                .IsUnicode(false);
        });

        modelBuilder.Entity<CustomerImage>(entity =>
        {
            entity.HasKey(e => new { e.CustomerId, e.ImageId });

            entity.HasIndex(e => e.CustomerId, "UQ_CustomerImages_CustomerId").IsUnique();

            entity.HasIndex(e => e.ImageId, "UQ_CustomerImages_ImageId").IsUnique();

            entity.HasOne(d => d.Customer).WithOne(p => p.CustomerImage)
                .HasForeignKey<CustomerImage>(d => d.CustomerId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_CustomerImages_Customers");

            entity.HasOne(d => d.Image).WithOne(p => p.CustomerImage)
                .HasForeignKey<CustomerImage>(d => d.ImageId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_CustomerImages_Images");
        });

        modelBuilder.Entity<Image>(entity =>
        {
            entity.Property(e => e.ImageId).HasDefaultValueSql("(newid())");
            entity.Property(e => e.ImageUrl).HasMaxLength(512);
            entity.Property(e => e.UploadedAt).HasDefaultValueSql("(sysdatetime())");
        });

        modelBuilder.Entity<LoyaltyPoint>(entity =>
        {
            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_LoyaltyPoints_Id");

            entity.HasOne(d => d.Customer).WithMany(p => p.LoyaltyPoints)
                .HasForeignKey(d => d.CustomerId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_LoyaltyPoints_Customers");
        });

        modelBuilder.Entity<Order>(entity =>
        {
            entity.HasIndex(e => e.CustomerId, "IX_Orders_CustomerId");

            entity.HasIndex(e => e.StatusId, "IX_Orders_StatusId");

            entity.HasIndex(e => e.OrderNumber, "UQ_Orders_OrderNumber").IsUnique();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())");
            entity.Property(e => e.AmountReceived).HasColumnType("decimal(10, 2)");
            entity.Property(e => e.ChangeAmount).HasColumnType("decimal(10, 2)");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("(getutcdate())")
                .HasColumnType("datetime");
            entity.Property(e => e.OrderNumber).HasDefaultValueSql("(NEXT VALUE FOR [dbo].[OrderNumberSeq])", "DF_Orders_OrderNumber_DEFAULT");
            entity.Property(e => e.SpecialInstructions)
                .HasMaxLength(100)
                .IsUnicode(false);
            entity.Property(e => e.Tips).HasColumnType("decimal(10, 2)");
            entity.Property(e => e.UpdatedAt).HasColumnType("datetime");

            entity.HasOne(d => d.CreatedByNavigation).WithMany(p => p.OrderCreatedByNavigations)
                .HasForeignKey(d => d.CreatedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Orders_CreatedBy");

            entity.HasOne(d => d.Customer).WithMany(p => p.Orders)
                .HasForeignKey(d => d.CustomerId)
                .HasConstraintName("FK_Orders_Customer");

            entity.HasOne(d => d.PaymentMethod).WithMany(p => p.Orders)
                .HasForeignKey(d => d.PaymentMethodId)
                .HasConstraintName("FK_Orders_PaymentMethods");

            entity.HasOne(d => d.Status).WithMany(p => p.Orders)
                .HasForeignKey(d => d.StatusId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Orders_Status");

            entity.HasOne(d => d.UpdatedByNavigation).WithMany(p => p.OrderUpdatedByNavigations)
                .HasForeignKey(d => d.UpdatedBy)
                .HasConstraintName("FK_Orders_UpdatedBy");
        });

        modelBuilder.Entity<OrderItem>(entity =>
        {
            entity.HasIndex(e => e.OrderId, "IX_OrderItems_OrderId");

            entity.HasIndex(e => e.ParentOrderItemId, "IX_OrderItems_ParentOrderItemId");

            entity.HasIndex(e => e.ProductId, "IX_OrderItems_ProductId");

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())");
            entity.Property(e => e.Price).HasColumnType("decimal(10, 2)");
            entity.Property(e => e.Quantity).HasDefaultValue(1);
            entity.Property(e => e.SpecialInstructions)
                .HasMaxLength(100)
                .IsUnicode(false);

            entity.HasOne(d => d.Order).WithMany(p => p.OrderItems)
                .HasForeignKey(d => d.OrderId)
                .HasConstraintName("FK_OrderItems_Order");

            entity.HasOne(d => d.ParentOrderItem).WithMany(p => p.InverseParentOrderItem)
                .HasForeignKey(d => d.ParentOrderItemId)
                .HasConstraintName("FK_OrderItems_ParentOrderItem");

            entity.HasOne(d => d.Product).WithMany(p => p.OrderItems)
                .HasForeignKey(d => d.ProductId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_OrderItems_Product");
        });

        modelBuilder.Entity<PaymentMethod>(entity =>
        {
            entity.HasIndex(e => e.Name, "UQ_PaymentMethods_Name").IsUnique();

            entity.Property(e => e.Name)
                .HasMaxLength(30)
                .IsUnicode(false);
        });

        modelBuilder.Entity<Product>(entity =>
        {
            entity.HasIndex(e => e.CategoryId, "IX_Products_CategoryId");

            entity.HasIndex(e => e.CreatedBy, "IX_Products_CreatedBy");

            entity.HasIndex(e => e.IsAddOn, "IX_Products_IsAddOn");

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())");
            entity.Property(e => e.Code).HasMaxLength(10);
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("(getutcdate())")
                .HasColumnType("datetime");
            entity.Property(e => e.Description).HasMaxLength(500);
            entity.Property(e => e.IsActive).HasDefaultValue(true);
            entity.Property(e => e.Name)
                .HasMaxLength(100)
                .IsUnicode(false);
            entity.Property(e => e.Price).HasColumnType("decimal(10, 2)");
            entity.Property(e => e.UpdatedAt).HasColumnType("datetime");

            entity.HasOne(d => d.Category).WithMany(p => p.Products)
                .HasForeignKey(d => d.CategoryId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Products_ProductCategories");

            entity.HasOne(d => d.CreatedByNavigation).WithMany(p => p.ProductCreatedByNavigations)
                .HasForeignKey(d => d.CreatedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Products_CreatedBy");

            entity.HasOne(d => d.UpdatedByNavigation).WithMany(p => p.ProductUpdatedByNavigations)
                .HasForeignKey(d => d.UpdatedBy)
                .HasConstraintName("FK_Products_UpdatedBy");
        });

        modelBuilder.Entity<ProductAddOn>(entity =>
        {
            entity.HasKey(e => new { e.ProductId, e.AddOnId });

            entity.ToTable(tb => tb.HasTrigger("TR_ProductAddOns_ValidateAddOn"));

            entity.HasIndex(e => e.AddOnId, "IX_ProductAddOns_AddOnId");

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
            entity.Property(e => e.UpdatedAt).HasColumnType("datetime");

            entity.HasOne(d => d.ProductAddOn).WithOne(p => p.ProductAddOnPriceOverride)
                .HasForeignKey<ProductAddOnPriceOverride>(d => new { d.ProductId, d.AddOnId })
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ProductAddOnPriceOverrides_ProductAddOn");
        });

        modelBuilder.Entity<ProductCategory>(entity =>
        {
            entity.Property(e => e.Id).ValueGeneratedNever();
            entity.Property(e => e.Name)
                .HasMaxLength(50)
                .IsUnicode(false);
        });

        modelBuilder.Entity<ProductImage>(entity =>
        {
            entity.HasKey(e => new { e.ProductId, e.ImageId });

            entity.HasIndex(e => e.ImageId, "UQ_ProductImages_ImageId").IsUnique();

            entity.HasIndex(e => e.ProductId, "UQ_ProductImages_ProductId").IsUnique();

            entity.HasOne(d => d.Image).WithOne(p => p.ProductImage)
                .HasForeignKey<ProductImage>(d => d.ImageId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ProductImages_Images");

            entity.HasOne(d => d.Product).WithOne(p => p.ProductImage)
                .HasForeignKey<ProductImage>(d => d.ProductId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ProductImages_Products");
        });

        modelBuilder.Entity<ProductPriceHistory>(entity =>
        {
            entity.ToTable("ProductPriceHistory");

            entity.HasIndex(e => e.ProductId, "IX_ProductPriceHistory_ProductId");

            entity.HasIndex(e => e.UpdatedAt, "IX_ProductPriceHistory_UpdatedAt").IsDescending();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())");
            entity.Property(e => e.NewPrice).HasColumnType("decimal(10, 2)");
            entity.Property(e => e.OldPrice).HasColumnType("decimal(10, 2)");
            entity.Property(e => e.UpdatedAt)
                .HasDefaultValueSql("(getutcdate())")
                .HasColumnType("datetime");

            entity.HasOne(d => d.Product).WithMany(p => p.ProductPriceHistories)
                .HasForeignKey(d => d.ProductId)
                .HasConstraintName("FK_ProductPriceHistory_Product");

            entity.HasOne(d => d.UpdatedByNavigation).WithMany(p => p.ProductPriceHistories)
                .HasForeignKey(d => d.UpdatedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ProductPriceHistory_UpdatedBy");
        });

        modelBuilder.Entity<RefreshToken>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__RefreshT__F5845E59");

            entity.HasIndex(e => e.Token, "UQ__RefreshT__1EB4F816").IsUnique();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_RefreshTokens_Id");
            entity.Property(e => e.CreatedAt).HasColumnType("datetime");
            entity.Property(e => e.ExpiresAt).HasColumnType("datetime");
            entity.Property(e => e.Token)
                .HasMaxLength(500)
                .IsUnicode(false);

            entity.HasOne(d => d.User).WithMany(p => p.RefreshTokens)
                .HasForeignKey(d => d.UserId)
                .HasConstraintName("FK__RefreshTokens__Users");
        });

        modelBuilder.Entity<ShortLink>(entity =>
        {
            entity.HasIndex(e => e.Token, "IX_ShortLinks").IsUnique();

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_ShortLinks_Id");
            entity.Property(e => e.TargetType)
                .HasMaxLength(50)
                .IsUnicode(false);
            entity.Property(e => e.TargetUrl).IsUnicode(false);
            entity.Property(e => e.Token)
                .HasMaxLength(20)
                .IsUnicode(false);
        });

        modelBuilder.Entity<Status>(entity =>
        {
            entity.Property(e => e.Name)
                .HasMaxLength(30)
                .IsUnicode(false);
        });

        modelBuilder.Entity<User>(entity =>
        {
            entity.HasIndex(e => e.RoleId, "IX_Users_RoleId");

            entity.Property(e => e.Id).HasDefaultValueSql("(newid())", "DF_Users_Id");
            entity.Property(e => e.FirstName)
                .HasMaxLength(50)
                .IsUnicode(false);
            entity.Property(e => e.IsActive).HasDefaultValue(true, "DF_Users_IsActive");
            entity.Property(e => e.LastName)
                .HasMaxLength(50)
                .IsUnicode(false);
            entity.Property(e => e.PasswordHash).IsUnicode(false);
            entity.Property(e => e.Username)
                .HasMaxLength(50)
                .IsUnicode(false);

            entity.HasOne(d => d.Role).WithMany(p => p.Users)
                .HasForeignKey(d => d.RoleId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Users_UserRoles");
        });

        modelBuilder.Entity<UserImage>(entity =>
        {
            entity.HasKey(e => new { e.UserId, e.ImageId }).HasName("PK_UserImage");

            entity.HasIndex(e => e.ImageId, "UQ_UserImage_ImageId").IsUnique();

            entity.HasIndex(e => e.UserId, "UQ_UserImage_UserId").IsUnique();

            entity.HasOne(d => d.Image).WithOne(p => p.UserImage)
                .HasForeignKey<UserImage>(d => d.ImageId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_UserImage_Images");

            entity.HasOne(d => d.User).WithOne(p => p.UserImage)
                .HasForeignKey<UserImage>(d => d.UserId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_UserImage_Users");
        });

        modelBuilder.Entity<UserRole>(entity =>
        {
            entity.HasIndex(e => e.Name, "UQ_UserRoles_Name").IsUnique();

            entity.Property(e => e.Id).ValueGeneratedNever();
            entity.Property(e => e.Name)
                .HasMaxLength(30)
                .IsUnicode(false);
        });
        modelBuilder.HasSequence("OrderNumberSeq").StartsAt(5L);

        OnModelCreatingPartial(modelBuilder);
    }

    partial void OnModelCreatingPartial(ModelBuilder modelBuilder);
}
