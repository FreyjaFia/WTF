namespace WTF.Api.Features.Items.DTOs;

public record ItemPriceHistoryDto(
    Guid Id,
    Guid ItemId,
    decimal? OldPrice,
    decimal NewPrice,
    DateTime UpdatedAt,
    Guid UpdatedBy,
    string? UpdatedByName);
