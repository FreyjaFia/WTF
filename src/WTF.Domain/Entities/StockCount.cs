namespace WTF.Domain.Entities;

public partial class StockCount
{
    public Guid Id { get; set; }

    public string Name { get; set; } = null!;

    public byte Status { get; set; }

    public bool IsBlind { get; set; }

    public string? Note { get; set; }

    public DateTime CreatedAt { get; set; }

    public Guid CreatedBy { get; set; }

    public DateTime? PostedAt { get; set; }

    public Guid? PostedBy { get; set; }

    public DateTime? CancelledAt { get; set; }

    public Guid? CancelledBy { get; set; }

    public Guid? TenantId { get; set; }

    public virtual User? CancelledByNavigation { get; set; }

    public virtual User CreatedByNavigation { get; set; } = null!;

    public virtual User? PostedByNavigation { get; set; }

    public virtual ICollection<StockCountLine> StockCountLines { get; set; } = new List<StockCountLine>();
}
