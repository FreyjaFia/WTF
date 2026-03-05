namespace WTF.Api.Features.Orders.DTOs;

public record OrderBundlePromotionDto(Guid PromotionId, string PromotionName, int Quantity, decimal UnitPrice);
