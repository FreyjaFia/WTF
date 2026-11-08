namespace WTF.Domain.Entities;

public partial class ProductSubCategory
{
    public int Id { get; set; }

    public string Name { get; set; } = null!;

    public Guid TenantId { get; set; }

    public int SortOrder { get; set; }

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public int? CategoryId { get; set; }

    public virtual ProductCategory? Category { get; set; }

    public virtual ICollection<Product> Products { get; set; } = new List<Product>();
}
