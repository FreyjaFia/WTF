namespace WTF.Api.Features.OrderLinks.DTOs;

// Everything the anonymous ordering page can see. No audit fields, staff names, user ids or other customers.

/// <summary>A sellable product or add-on. For an add-on, <see cref="Price"/> is already the price for this product.</summary>
public record PublicProductDto(
    Guid Id,
    string Name,
    string? Description,
    decimal Price,
    int Category,
    int? SubCategory,
    string? ImageUrl,
    int AddOnCount
);

public record PublicAddOnGroupDto(int Type, string DisplayName, List<PublicProductDto> Options);

public record PublicDealAddOnDto(Guid AddOnProductId, int Quantity);

// A discount that is on right now, for the customer's cart: the product, the exact add-ons it needs, and what comes off.
// No promotion id or name. Remaining is how many more items it can discount, or null when it has no usage limit.
public record PublicDealDto(
    Guid ProductId,
    decimal? AmountOff,
    decimal? PercentOff,
    List<PublicDealAddOnDto> AddOns,
    int? Remaining,
    int? MaxPerOrder = null,
    string? GroupKey = null
);

public record PublicCatalogDto(
    List<PublicProductDto> Products,
    Dictionary<Guid, List<PublicAddOnGroupDto>> AddOnsByProductId,
    List<PublicDealDto> Deals
);

public record PublicOrderLinkDto(
    string FirstName,
    string? Address,
    string? ContactNumber,
    string? ImageUrl,
    DateTime? ExpiresAt,
    PublicCatalogDto Catalog
);

public record PublicOrderAddOnDto(string Name, int Quantity, decimal UnitPrice);

public record PublicOrderItemDto(
    string Name,
    int Quantity,
    decimal UnitPrice,
    List<PublicOrderAddOnDto> AddOns,
    string? SpecialInstructions
);

/// <summary>
/// <see cref="StatusKind"/> is one of waiting, accepted, ready, completed, rejected, cancelled or refunded, so the page
/// can pick a badge color without knowing the internal status ids. The three times draw the timeline: when staff
/// accepted it, when it was ready, and when it ended (completed, rejected, cancelled or refunded).
/// </summary>
public record PublicOrderDto(
    Guid Id,
    int OrderNumber,
    DateTime CreatedAt,
    string StatusLabel,
    string StatusKind,
    string? RejectionReason,
    List<PublicOrderItemDto> Items,
    decimal Total,
    string? FulfillmentType,
    string? DeliveryAddress,
    string? ContactNumber,
    string? PaymentMethod,
    decimal? AmountReceived,
    decimal? Tips,
    string? SpecialInstructions,
    DateTime? AcceptedAt = null,
    DateTime? ReadyAt = null,
    DateTime? FinishedAt = null
);
