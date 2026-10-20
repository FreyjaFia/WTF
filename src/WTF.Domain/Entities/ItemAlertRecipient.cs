namespace WTF.Domain.Entities;

public partial class ItemAlertRecipient
{
    public Guid Id { get; set; }

    public Guid ItemId { get; set; }

    public Guid UserId { get; set; }

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public Guid CreatedBy { get; set; }

    public virtual User CreatedByNavigation { get; set; } = null!;

    public virtual Item Item { get; set; } = null!;

    public virtual User User { get; set; } = null!;
}
