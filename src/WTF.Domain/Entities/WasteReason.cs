namespace WTF.Domain.Entities;

public partial class WasteReason
{
    public int Id { get; set; }

    public string Name { get; set; } = null!;

    public bool RequiresNote { get; set; }

    public int SortOrder { get; set; }

    public bool IsActive { get; set; }

    public bool IsSystem { get; set; }

    public DateTime CreatedAt { get; set; }

    public Guid? CreatedBy { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public Guid? UpdatedBy { get; set; }

    public virtual User? CreatedByNavigation { get; set; }

    public virtual ICollection<StockWaste> StockWastes { get; set; } = new List<StockWaste>();

    public virtual User? UpdatedByNavigation { get; set; }
}
