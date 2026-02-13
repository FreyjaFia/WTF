using MediatR;
using System.ComponentModel.DataAnnotations;
using WTF.Contracts.Products.Enums;

namespace WTF.Contracts.Products.Commands;

public record CreateProductCommand : IRequest<ProductDto>
{
    [Required(ErrorMessage = "Product name is required")]
    [StringLength(100, ErrorMessage = "Name cannot exceed 100 characters")]
    public string Name { get; init; } = string.Empty;

    [Required(ErrorMessage = "Price is required")]
    [Range(0.01, 999999.99, ErrorMessage = "Price must be between 0.01 and 999,999.99")]
    public decimal Price { get; init; }

    [Required(ErrorMessage = "Product category is required")]
    public ProductCategoryEnum Category { get; init; }

    public bool IsAddOn { get; init; }

    public bool IsActive { get; init; } = true;
}
