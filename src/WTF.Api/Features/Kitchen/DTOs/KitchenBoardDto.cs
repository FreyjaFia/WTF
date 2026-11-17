namespace WTF.Api.Features.Kitchen.DTOs;

public record KitchenBoardDto(List<KitchenOrderDto> Orders, DateTime ServerTime);
