using MediatR;
using System.ComponentModel.DataAnnotations;
using WTF.Contracts.OrderItems;

namespace WTF.Contracts.Orders.Commands;

public record UpdateOrderCommand : IRequest<OrderDto?>
{
    [Required]
    public Guid Id { get; init; }

    [Required]
    public Guid? CustomerId { get; init; }

    [Required]
    public List<OrderItemDto> Items { get; init; } = [];

    [Required]
    public int Status { get; init; }
}
