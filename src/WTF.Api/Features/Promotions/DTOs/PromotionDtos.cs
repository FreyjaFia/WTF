namespace WTF.Api.Features.Promotions.DTOs;

public static class PromotionTypeIds
{
    public const int FixedBundle = 1;
    public const int MixMatch = 2;
    public const int DiscountedProduct = 3;
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
    decimal? FixedPrice,
    decimal? PercentOff,
    DateTime CreatedAt,
    Guid CreatedBy,
    DateTime? UpdatedAt,
    Guid? UpdatedBy,
    PromotionScheduleDto? Schedule = null);

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
    List<FixedBundleItemDto> Items,
    PromotionScheduleDto? Schedule = null);

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
    List<MixMatchItemDto> Items,
    PromotionScheduleDto? Schedule = null);

public sealed record DiscountedProductAddOnDto(
    Guid? Id,
    Guid AddOnProductId,
    int Quantity);

public sealed record DiscountedProductItemDto(
    Guid? Id,
    Guid ProductId,
    decimal? FixedPrice,
    decimal? PercentOff,
    List<DiscountedProductAddOnDto> AddOns);

public sealed record DiscountedProductPromotionDto(
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
    List<DiscountedProductItemDto> Items,
    PromotionScheduleDto? Schedule = null);

// What a promotion runs on: the weekdays (bit mask, Sunday = 1), the daily window and the usage limit. Redemptions is
// how many uses it has had so far.
public sealed record PromotionScheduleRequest(
    byte? DaysOfWeek,
    string? StartTime,
    string? EndTime,
    int? MaxRedemptions,
    int? MaxPerOrder = null);

public sealed record PromotionScheduleDto(
    byte? DaysOfWeek,
    string? StartTime,
    string? EndTime,
    int? MaxRedemptions,
    int Redemptions,
    int? MaxPerOrder = null);

public sealed record PromotionImageDto(
    Guid PromotionId,
    string? ImageUrl);

