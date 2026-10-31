namespace WTF.Domain.Entities;

public partial class ProductSizeAmount
{
    public Guid Id { get; set; }

    public Guid ProductId { get; set; }

    public Guid SizeProductId { get; set; }

    public Guid ItemId { get; set; }

    public decimal Quantity { get; set; }

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public Guid CreatedBy { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public Guid? UpdatedBy { get; set; }

    public virtual User CreatedByNavigation { get; set; } = null!;

    public virtual Item Item { get; set; } = null!;

    public virtual Product Product { get; set; } = null!;

    public virtual Product SizeProduct { get; set; } = null!;

    public virtual User? UpdatedByNavigation { get; set; }
}
