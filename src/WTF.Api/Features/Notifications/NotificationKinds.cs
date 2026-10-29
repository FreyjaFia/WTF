namespace WTF.Api.Features.Notifications;

public static class NotificationKinds
{
    public const string StockAlert = "StockAlert";
    public const string WasteReview = "WasteReview";
}

public static class NotificationSeverity
{
    public const byte Info = 0;
    public const byte Warning = 1;
    public const byte Critical = 2;
}
