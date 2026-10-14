namespace WTF.Domain.Entities;

public partial class ShortLink
{
    public Guid Id { get; set; }

    public string Token { get; set; } = null!;

    public string TargetType { get; set; } = null!;

    public Guid? TargetId { get; set; }

    public string? TargetUrl { get; set; }

    public DateTime? ExpiresAt { get; set; }

    public DateTime CreatedAt { get; set; }

    public Guid? CreatedBy { get; set; }

    public DateTime? RevokedAt { get; set; }

    public DateTime? LastUsedAt { get; set; }

    public virtual User? CreatedByNavigation { get; set; }

    public virtual ICollection<Order> Orders { get; set; } = new List<Order>();
}
