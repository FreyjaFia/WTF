namespace WTF.Domain.Entities;

public partial class StockNotification
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public Guid ItemId { get; set; }

    public byte Status { get; set; }

    public decimal Quantity { get; set; }

    public string Title { get; set; } = null!;

    public string Body { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    public DateTime? ReadAt { get; set; }

    public int ReminderCount { get; set; }

    public DateTime? LastRemindedAt { get; set; }

    public virtual Item Item { get; set; } = null!;

    public virtual User User { get; set; } = null!;
}
