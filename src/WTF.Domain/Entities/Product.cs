using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class Product
{
    public Guid Id { get; set; }

    public string Name { get; set; } = null!;

    public decimal Price { get; set; }

    public int CategoryId { get; set; }

    public bool IsAddOn { get; set; }

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public Guid CreatedBy { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public Guid? UpdatedBy { get; set; }

    public string? Description { get; set; }

    public string Code { get; set; } = null!;

    public virtual ProductCategory Category { get; set; } = null!;

    public virtual User CreatedByNavigation { get; set; } = null!;

    public virtual ICollection<OrderItem> OrderItems { get; set; } = new List<OrderItem>();

    public virtual ProductImage? ProductImage { get; set; }

    public virtual ICollection<ProductPriceHistory> ProductPriceHistories { get; set; } = new List<ProductPriceHistory>();

    public virtual User? UpdatedByNavigation { get; set; }

    public virtual ICollection<Product> AddOns { get; set; } = new List<Product>();

    public virtual ICollection<Product> Products { get; set; } = new List<Product>();
}
