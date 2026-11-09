namespace WTF.Domain.Entities;

public partial class UserRole
{
    public int Id { get; set; }

    public string Name { get; set; } = null!;

    public Guid? TenantId { get; set; }

    public bool IsSystem { get; set; }

    public string? Description { get; set; }

    public DateTime? CreatedAt { get; set; }

    public virtual ICollection<RolePermission> RolePermissions { get; set; } = new List<RolePermission>();

    public virtual Tenant? Tenant { get; set; }

    public virtual ICollection<User> Users { get; set; } = new List<User>();
}
