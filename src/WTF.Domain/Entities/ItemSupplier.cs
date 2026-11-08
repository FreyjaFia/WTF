namespace WTF.Domain.Entities;

public partial class ItemSupplier
{
    public Guid Id { get; set; }

    public Guid ItemId { get; set; }

    public Guid SupplierId { get; set; }

    public string? SupplierItemCode { get; set; }

    public string? PackName { get; set; }

    public decimal UnitsPerPack { get; set; }

    public decimal? PackPrice { get; set; }

    public bool IsPreferred { get; set; }

    public DateTime CreatedAt { get; set; }

    public Guid CreatedBy { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public Guid? UpdatedBy { get; set; }

    public Guid TenantId { get; set; }

    public virtual User CreatedByNavigation { get; set; } = null!;

    public virtual Item Item { get; set; } = null!;

    public virtual ICollection<ItemSupplierPriceHistory> ItemSupplierPriceHistories { get; set; } = new List<ItemSupplierPriceHistory>();

    public virtual Supplier Supplier { get; set; } = null!;

    public virtual Tenant Tenant { get; set; } = null!;

    public virtual User? UpdatedByNavigation { get; set; }
}
