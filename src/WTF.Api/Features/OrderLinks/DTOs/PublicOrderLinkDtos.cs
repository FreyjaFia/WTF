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

public record PublicCatalogDto(
    List<PublicProductDto> Products,
    Dictionary<Guid, List<PublicAddOnGroupDto>> AddOnsByProductId
);

public record PublicOrderLinkDto(
    string FirstName,
    string? Address,
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
/// <see cref="StatusKind"/> is one of waiting, accepted, completed, rejected, cancelled or refunded, so the page can
/// pick a badge color without knowing the internal status ids.
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
    string? SpecialInstructions
);
