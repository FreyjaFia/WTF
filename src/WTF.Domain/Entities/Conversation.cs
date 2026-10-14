namespace WTF.Domain.Entities;

public partial class Conversation
{
    public Guid Id { get; set; }

    public Guid CustomerId { get; set; }

    public byte Kind { get; set; }

    public Guid? OrderId { get; set; }

    public string Title { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    public DateTime LastMessageAt { get; set; }

    public DateTime? ClosedAt { get; set; }

    public virtual ICollection<ConversationMessage> ConversationMessages { get; set; } = new List<ConversationMessage>();

    public virtual Customer Customer { get; set; } = null!;

    public virtual Order? Order { get; set; }
}
