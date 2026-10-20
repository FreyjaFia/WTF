namespace WTF.Domain.Entities;

public partial class Notification
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public string Title { get; set; } = null!;

    public string Body { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    public DateTime? ReadAt { get; set; }

    public int ReminderCount { get; set; }

    public DateTime? LastRemindedAt { get; set; }

    public string Kind { get; set; } = null!;

    public byte Severity { get; set; }

    public string? Path { get; set; }

    public Guid? SubjectId { get; set; }

    public string? Data { get; set; }

    public virtual User User { get; set; } = null!;
}
