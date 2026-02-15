using MediatR;
using System.ComponentModel.DataAnnotations;

namespace WTF.Contracts.Products.Commands;

public record AssignAddOnProductsCommand : IRequest<bool>
{
    [Required]
    public Guid AddOnId { get; init; }

    [Required]
    public List<Guid> ProductIds { get; init; } = [];
}
