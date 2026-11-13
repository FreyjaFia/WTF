namespace WTF.Domain.Entities;

public partial class CatalogChangeLog
{
    public Guid Id { get; set; }

    public string EntityType { get; set; } = null!;

    public Guid EntityId { get; set; }

    public string Field { get; set; } = null!;

    public string? OldValue { get; set; }

    public string? NewValue { get; set; }

    public DateTime EffectiveFrom { get; set; }

    public Guid? ChangedBy { get; set; }

    public DateTime CreatedAt { get; set; }

    public Guid TenantId { get; set; }

    public virtual Tenant Tenant { get; set; } = null!;
}
