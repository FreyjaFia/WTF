using System.ComponentModel.DataAnnotations;
using WTF.Contracts.Products.Enums;

namespace WTF.Contracts.Products;

public class ProductRequestDto
{
    [Required(ErrorMessage = "Product name is required")]
    public string Name { get; set; } = string.Empty;

    [Range(0, double.MaxValue, ErrorMessage = "Price must be non-negative")]
    public decimal Price { get; set; }

    [Required(ErrorMessage = "Product type is required")]
    public ProductTypeEnum Type { get; set; }

    public bool IsAddOn { get; set; }
    public bool IsActive { get; set; }
}
