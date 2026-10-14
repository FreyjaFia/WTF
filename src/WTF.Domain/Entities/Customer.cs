namespace WTF.Domain.Entities;

public partial class Customer
{
    public Guid Id { get; set; }

    public string FirstName { get; set; } = null!;

    public string LastName { get; set; } = null!;

    public string? Address { get; set; }

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public Guid CreatedBy { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public Guid? UpdatedBy { get; set; }

    public bool AllowOrderingLink { get; set; }

    public string? ContactNumber { get; set; }

    public virtual ICollection<Conversation> Conversations { get; set; } = new List<Conversation>();

    public virtual User CreatedByNavigation { get; set; } = null!;

    public virtual CustomerImage? CustomerImage { get; set; }

    public virtual ICollection<LoyaltyPoint> LoyaltyPoints { get; set; } = new List<LoyaltyPoint>();

    public virtual ICollection<Order> Orders { get; set; } = new List<Order>();

    public virtual User? UpdatedByNavigation { get; set; }
}
