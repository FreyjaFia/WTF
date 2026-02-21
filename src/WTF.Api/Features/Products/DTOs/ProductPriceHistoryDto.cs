namespace WTF.Api.Features.Products.DTOs;

public record ProductPriceHistoryDto(Guid Id, Guid ProductId, decimal? OldPrice, decimal NewPrice, DateTime UpdatedAt, Guid UpdatedBy, string? UpdatedByName);
