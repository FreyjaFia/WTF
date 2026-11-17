using WTF.Api.Features.Orders.Enums;

namespace WTF.Api.Features.Kitchen.DTOs;

// What the kitchen may see of an order: no prices, totals, payment data, notes of the staff, address or phone number.
public record KitchenOrderDto(
    Guid Id,
    int OrderNumber,
    DateTime CreatedAt,
    byte KitchenStatus,
    DateTime? StartedAt,
    DateTime? ReadyAt,
    DateTime? ServedAt,
    OrderSourceEnum Source,
    FulfillmentTypeEnum? FulfillmentType,
    string? CustomerName,
    string? SpecialInstructions,
    List<KitchenLineDto> Lines,
    string? ChangeNote,
    byte? ChangeKind,
    bool IsStale,
    bool IsStopMaking);
