namespace WTF.Api.Features.Dashboard.DTOs;

public record RecentOrderDto(
    Guid Id,
    int OrderNumber,
    DateTime CreatedAt,
    decimal TotalAmount,
    int StatusId,
    string StatusName);
