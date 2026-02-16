using MediatR;
using System.ComponentModel.DataAnnotations;
using WTF.Contracts.Products;

namespace WTF.Contracts.Products.Commands;

public record AssignAddOnProductsCommand : IRequest<bool>
{
    [Required]
    public Guid AddOnId { get; init; }

    [Required]
    public List<AddOnProductAssignmentDto> Products { get; init; } = [];
}
