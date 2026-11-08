namespace WTF.Api.Common.Tenancy;

public static class OfflineSyncWindow
{
    public const int MaxAgeDays = 7;

    public const string LastOnlineHeader = "X-Last-Online";

    private const string CutoffKey = "WTF.OfflineSyncCutoff";

    public static bool IsOfflineSyncRoute(HttpRequest request) =>
        HttpMethods.IsPost(request.Method)
        && (request.Path.Equals("/api/orders/sync", StringComparison.OrdinalIgnoreCase)
            || request.Path.Equals("/api/orders/batch", StringComparison.OrdinalIgnoreCase));

    public static void Open(HttpContext context, DateTime closedSince) => context.Items[CutoffKey] = closedSince;

    public static string? Check(HttpContext? context, DateTime? claimedAt, DateTime utcNow)
    {
        if (context?.Items[CutoffKey] is not DateTime closedSince)
        {
            return null;
        }

        if (claimedAt is not { } claimed)
        {
            return TenantAccess.SubscriptionEndedMessage;
        }

        var effective = claimed.ToUniversalTime();
        if (DateTime.TryParse(context.Request.Headers[LastOnlineHeader], null, System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out var lastOnline)
            && lastOnline < effective)
        {
            effective = lastOnline;
        }

        if (effective > utcNow)
        {
            effective = utcNow;
        }

        if (effective > closedSince)
        {
            return TenantAccess.SubscriptionEndedMessage;
        }

        return effective < utcNow.AddDays(-MaxAgeDays)
            ? $"This order is older than {MaxAgeDays} days and can no longer be accepted."
            : null;
    }
}
