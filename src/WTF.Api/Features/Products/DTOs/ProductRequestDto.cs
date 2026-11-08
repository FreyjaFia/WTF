using System.ComponentModel.DataAnnotations;

namespace WTF.Api.Features.Products.DTOs;

public class ProductRequestDto
{
    [Required]
    public string Name { get; set; } = string.Empty;

    [Range(0, double.MaxValue)]
    public decimal Price { get; set; }

    [Required]
    public int Category { get; set; }

    public bool IsAddOn { get; set; }

    public bool IsActive { get; set; }
}
