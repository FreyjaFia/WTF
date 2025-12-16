using System.ComponentModel.DataAnnotations;
using WTF.Contracts.OrderItems;

namespace WTF.Contracts.Orders;

public class OrderRequestDto
{
    [Required]
    public Guid? CustomerId { get; set; }

    [Required]
    public List<OrderItemDto> Items { get; set; } = new();

    [Required]
    public string Status { get; set; } = string.Empty;

    public bool IsActive { get; set; } = true;
}
