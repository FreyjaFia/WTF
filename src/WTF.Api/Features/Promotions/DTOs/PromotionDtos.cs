namespace WTF.Api.Features.Promotions.DTOs;

public static class PromotionTypeIds
{
    public const int FixedBundle = 1;
    public const int MixMatch = 2;
}

public sealed record PromotionListItemDto(
    Guid Id,
    string Name,
    int TypeId,
    bool IsActive,
    DateTime? StartDate,
    DateTime? EndDate,
    string? ImageUrl,
    decimal? BundlePrice,
    DateTime CreatedAt,
    Guid CreatedBy,
    DateTime? UpdatedAt,
    Guid? UpdatedBy);

public sealed record FixedBundleItemAddOnDto(
    Guid? Id,
    Guid AddOnProductId,
    int Quantity);

public sealed record FixedBundleItemDto(
    Guid? Id,
    Guid ProductId,
    int Quantity,
    List<FixedBundleItemAddOnDto> AddOns);

public sealed record FixedBundlePromotionDto(
    Guid Id,
    string Name,
    bool IsActive,
    DateTime? StartDate,
    DateTime? EndDate,
    string? ImageUrl,
    DateTime CreatedAt,
    Guid CreatedBy,
    DateTime? UpdatedAt,
    Guid? UpdatedBy,
    decimal BundlePrice,
    List<FixedBundleItemDto> Items);

public sealed record MixMatchItemAddOnDto(
    Guid? Id,
    Guid AddOnProductId,
    int Quantity);

public sealed record MixMatchItemDto(
    Guid? Id,
    Guid ProductId,
    List<MixMatchItemAddOnDto> AddOns);

public sealed record MixMatchPromotionDto(
    Guid Id,
    string Name,
    bool IsActive,
    DateTime? StartDate,
    DateTime? EndDate,
    string? ImageUrl,
    DateTime CreatedAt,
    Guid CreatedBy,
    DateTime? UpdatedAt,
    Guid? UpdatedBy,
    int RequiredQuantity,
    int? MaxSelectionsPerOrder,
    decimal BundlePrice,
    List<MixMatchItemDto> Items);

public sealed class PromotionCartAddOnLineDto
{
    public Guid AddOnProductId { get; set; }
    public int Quantity { get; set; }
}

public sealed class PromotionCartLineDto
{
    public string LineId { get; set; } = string.Empty;
    public Guid ProductId { get; set; }
    public int Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public List<PromotionCartAddOnLineDto> AddOns { get; set; } = [];
    public bool IsPromoLine { get; set; }
    public bool IsFreeItem { get; set; }
    public string? BundleParentId { get; set; }
    public string? TriggerLineId { get; set; }
    public Guid? PromotionId { get; set; }
    public bool IsLocked { get; set; }
}

public sealed record EvaluatePromotionsRequestDto(
    List<PromotionCartLineDto> Lines,
    DateTime? EvaluatedAtUtc);

public sealed record EvaluatePromotionsResponseDto(
    List<PromotionCartLineDto> Lines);

public sealed record PromotionImageDto(
    Guid PromotionId,
    string? ImageUrl);

