namespace WTF.Api.Features.Inventory.DTOs;

public record StockNotificationDto(
    Guid Id,
    Guid ItemId,
    string ItemName,
    string Status,
    decimal Quantity,
    string Title,
    string Body,
    DateTime CreatedAt,
    bool IsRead);

public record StockNotificationListDto(List<StockNotificationDto> Items, int TotalCount, int UnreadCount);

public record AlertRecipientDto(Guid UserId, string Name, string Role);

public record ItemAlertRecipientsDto(
    List<Guid> SelectedUserIds,
    List<AlertRecipientDto> Candidates,
    string DefaultDescription);
