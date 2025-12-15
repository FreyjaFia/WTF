using MediatR;
using System.ComponentModel.DataAnnotations;
using WTF.Contracts.OrderItems;
using WTF.Contracts.Orders.Enums;

namespace WTF.Contracts.Orders.Commands;

public record CreateOrderCommand : IRequest<OrderDto>
{
    [Required]
    public Guid? CustomerId { get; init; }

    [Required]
    public List<OrderItemDto> Items { get; init; } = [];

    [Required]
    public OrderStatusEnum Status { get; init; }
}
