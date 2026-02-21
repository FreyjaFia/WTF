using System.ComponentModel.DataAnnotations;
using WTF.Api.Features.Products.Enums;

namespace WTF.Api.Features.Products.DTOs;

public class ProductRequestDto
{
    [Required]
    public string Name { get; set; } = string.Empty;

    [Range(0, double.MaxValue)]
    public decimal Price { get; set; }

    [Required]
    public ProductCategoryEnum Category { get; set; }

    public bool IsAddOn { get; set; }

    public bool IsActive { get; set; }
}
