namespace WTF.Domain.Entities;

public partial class RolePermission
{
    public int RoleId { get; set; }

    public string PermissionKey { get; set; } = null!;

    public virtual UserRole Role { get; set; } = null!;
}
