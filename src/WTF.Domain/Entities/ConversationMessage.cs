namespace WTF.Domain.Entities;

public partial class ConversationMessage
{
    public Guid Id { get; set; }

    public Guid ConversationId { get; set; }

    public byte SenderType { get; set; }

    public Guid? SenderUserId { get; set; }

    public string Body { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    public DateTime? ReadByStaffAt { get; set; }

    public DateTime? ReadByCustomerAt { get; set; }

    public string? ImageKey { get; set; }

    public string? ImageContentType { get; set; }

    public int? ImageWidth { get; set; }

    public int? ImageHeight { get; set; }

    public int? ImageSizeBytes { get; set; }

    public DateTime? ImageRemovedAt { get; set; }

    public virtual Conversation Conversation { get; set; } = null!;

    public virtual User? SenderUser { get; set; }
}
