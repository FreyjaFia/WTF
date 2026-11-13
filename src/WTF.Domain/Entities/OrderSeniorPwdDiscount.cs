namespace WTF.Domain.Entities;

public partial class OrderSeniorPwdDiscount
{
    public Guid Id { get; set; }

    public Guid OrderId { get; set; }

    public byte Type { get; set; }

    public string IdNumber { get; set; } = null!;

    public string CustomerName { get; set; } = null!;

    public decimal CoveredAmount { get; set; }

    public decimal VatExemptAmount { get; set; }

    public decimal DiscountAmount { get; set; }

    public Guid RecordedBy { get; set; }

    public DateTime CreatedAt { get; set; }

    public Guid TenantId { get; set; }

    public virtual ICollection<OrderItem> OrderItems { get; set; } = new List<OrderItem>();

    public virtual Order Order { get; set; } = null!;

    public virtual User RecordedByNavigation { get; set; } = null!;

    public virtual Tenant Tenant { get; set; } = null!;
}
