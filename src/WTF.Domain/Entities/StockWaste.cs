namespace WTF.Domain.Entities;

public partial class StockWaste
{
    public Guid Id { get; set; }

    public Guid ItemId { get; set; }

    public Guid StockMovementId { get; set; }

    public decimal Quantity { get; set; }

    public int WasteReasonId { get; set; }

    public string ReasonName { get; set; } = null!;

    public string? Notes { get; set; }

    public byte Status { get; set; }

    public bool RequiresReview { get; set; }

    public DateTime? ReviewedAt { get; set; }

    public Guid? ReviewedBy { get; set; }

    public string? ReviewNote { get; set; }

    public DateTime? ReversedAt { get; set; }

    public Guid? ReversedBy { get; set; }

    public string? ReversalReason { get; set; }

    public Guid? ReversalMovementId { get; set; }

    public byte Source { get; set; }

    public DateTime CreatedAt { get; set; }

    public Guid CreatedBy { get; set; }

    public Guid? ClientRequestId { get; set; }

    public virtual User CreatedByNavigation { get; set; } = null!;

    public virtual Item Item { get; set; } = null!;

    public virtual StockMovement? ReversalMovement { get; set; }

    public virtual User? ReversedByNavigation { get; set; }

    public virtual User? ReviewedByNavigation { get; set; }

    public virtual StockMovement StockMovement { get; set; } = null!;

    public virtual WasteReason WasteReason { get; set; } = null!;
}
