namespace WTF.Domain.Entities;

public partial class AddOnType
{
    public int Id { get; set; }

    public string Name { get; set; } = null!;

    public Guid TenantId { get; set; }

    public string? SystemKey { get; set; }

    public bool IsRequired { get; set; }

    public int MinSelect { get; set; }

    public int MaxSelect { get; set; }

    public int SortOrder { get; set; }

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public virtual ICollection<ProductAddOn> ProductAddOns { get; set; } = new List<ProductAddOn>();
}
