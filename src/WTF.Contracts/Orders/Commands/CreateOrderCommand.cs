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
    public List<OrderItemRequestDto> Items { get; init; } = [];
    public string? SpecialInstructions { get; init; }

    [Required]
    public OrderStatusEnum Status { get; init; }

    public PaymentMethodEnum? PaymentMethod { get; init; }

    public decimal? AmountReceived { get; init; }

    public decimal? ChangeAmount { get; init; }

    public decimal? Tips { get; init; }
}
