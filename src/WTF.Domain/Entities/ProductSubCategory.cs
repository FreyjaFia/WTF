namespace WTF.Domain.Entities;

public partial class ProductSubCategory
{
    public int Id { get; set; }

    public string Name { get; set; } = null!;

    public Guid TenantId { get; set; }

    public virtual ICollection<Product> Products { get; set; } = new List<Product>();
}
