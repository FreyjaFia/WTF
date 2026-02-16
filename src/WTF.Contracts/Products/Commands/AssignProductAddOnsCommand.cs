using MediatR;
using System.ComponentModel.DataAnnotations;
using WTF.Contracts.Products;

namespace WTF.Contracts.Products.Commands;

public record AssignProductAddOnsCommand : IRequest<bool>
{
    [Required]
    public Guid ProductId { get; init; }

    [Required]
    public List<ProductAddOnAssignmentDto> AddOns { get; init; } = [];
}
