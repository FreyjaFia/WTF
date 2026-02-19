using MediatR;
using System.ComponentModel.DataAnnotations;

namespace WTF.Contracts.Products.Commands;

public record CreateProductAddOnPriceOverrideCommand : IRequest<ProductAddOnPriceOverrideDto?>
{
    [Required]
    public Guid ProductId { get; init; }

    [Required]
    public Guid AddOnId { get; init; }

    [Range(0, double.MaxValue)]
    public decimal Price { get; init; }

    public bool IsActive { get; init; } = true;
}
