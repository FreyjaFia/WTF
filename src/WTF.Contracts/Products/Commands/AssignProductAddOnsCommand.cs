using MediatR;
using System.ComponentModel.DataAnnotations;

namespace WTF.Contracts.Products.Commands;

public record AssignProductAddOnsCommand : IRequest<bool>
{
    [Required]
    public Guid ProductId { get; init; }

    [Required]
    public List<ProductAddOnAssignmentDto> AddOns { get; init; } = [];
}
