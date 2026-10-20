namespace WTF.Api.Features.Notifications.DTOs;

public record NotificationDto(
    Guid Id,
    string Kind,
    string Severity,
    string Title,
    string Body,
    string? Path,
    Guid? SubjectId,
    DateTime CreatedAt,
    bool IsRead,
    int ReminderCount);

public record NotificationListDto(
    List<NotificationDto> Items,
    int TotalCount,
    int UnreadCount,
    Dictionary<string, int> UnreadByKind);

public record NotificationCountsDto(int UnreadCount, Dictionary<string, int> UnreadByKind);
