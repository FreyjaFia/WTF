namespace WTF.Api.Features.Products.DTOs;

public record ProductAddOnPriceOverrideDto(Guid ProductId, Guid AddOnId, decimal Price, bool IsActive);
