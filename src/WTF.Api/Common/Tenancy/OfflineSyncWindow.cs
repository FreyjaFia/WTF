namespace WTF.Api.Common.Tenancy;

public static class OfflineSyncWindow
{
    public const int MaxAgeDays = 7;

    public const string LastOnlineHeader = "X-Last-Online";

    public static readonly TimeSpan ClockSkew = TimeSpan.FromMinutes(5);

    private const string CutoffKey = "WTF.OfflineSyncCutoff";

    public static bool IsOfflineSyncRoute(HttpRequest request) =>
        HttpMethods.IsPost(request.Method)
        && (request.Path.Equals("/api/orders/sync", StringComparison.OrdinalIgnoreCase)
            || request.Path.Equals("/api/orders/batch", StringComparison.OrdinalIgnoreCase));

    public static void Open(HttpContext context, DateTime closedSince) => context.Items[CutoffKey] = closedSince;

    public static string? CheckClaimedTime(DateTime? claimedAt, DateTime utcNow, TimeSpan? maxAge)
    {
        if (claimedAt is not { } claimed)
        {
            return null;
        }

        var effective = claimed.ToUniversalTime();
        if (effective > utcNow.Add(ClockSkew))
        {
            return "The order time cannot be in the future.";
        }

        return maxAge is { } age && effective < utcNow - age ? "The order time is too far in the past." : null;
    }

    public static string? CheckCatalogTime(DateTime? catalogSyncedAt, DateTime? orderTime, DateTime utcNow)
    {
        if (catalogSyncedAt is not { } synced)
        {
            return null;
        }

        var soldAt = orderTime?.ToUniversalTime() ?? utcNow;
        return synced.ToUniversalTime() > soldAt.Add(ClockSkew) ? "The catalog time cannot be after the order time." : null;
    }

    public static string? CheckOnlineCreate(HttpContext? context, DateTime? claimedAt, DateTime utcNow)
    {
        return CheckClaimedTime(claimedAt, utcNow, ClockSkew) ?? Check(context, claimedAt, utcNow);
    }

    public static string? Check(HttpContext? context, DateTime? claimedAt, DateTime utcNow)
    {
        if (claimedAt is { } claimedTime)
        {
            var claimedUtc = claimedTime.ToUniversalTime();
            if (claimedUtc > utcNow.Add(ClockSkew))
            {
                return "The order time cannot be in the future.";
            }

            if (claimedUtc < utcNow.AddDays(-MaxAgeDays))
            {
                return $"This order is older than {MaxAgeDays} days and can no longer be accepted.";
            }
        }

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
