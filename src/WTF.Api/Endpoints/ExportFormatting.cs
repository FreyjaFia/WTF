using System.Globalization;
using WTF.Api.Common.Time;

namespace WTF.Api.Endpoints;

/// <summary>Formatting shared by the Excel and PDF exports.</summary>
internal static class ExportFormatting
{
    public static TimeZoneInfo ResolveTimeZone(HttpContext httpContext)
    {
        return RequestTimeZone.Resolve(httpContext.Request.Headers["X-TimeZone"].ToString());
    }

    public static string BuildGeneratedAtLabel(HttpContext httpContext)
    {
        var requestedTimeZoneId = httpContext.Request.Headers["X-TimeZone"].ToString();
        var timeZone = RequestTimeZone.Resolve(requestedTimeZoneId);
        var generatedAtLocal = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, timeZone);
        var offset = timeZone.GetUtcOffset(generatedAtLocal);
        var offsetSign = offset < TimeSpan.Zero ? "-" : "+";
        var offsetLabel = $"{offsetSign}{Math.Abs(offset.Hours):00}:{Math.Abs(offset.Minutes):00}";
        var timeZoneLabel = string.IsNullOrWhiteSpace(requestedTimeZoneId)
            ? $"UTC{offsetLabel}"
            : $"{requestedTimeZoneId} (UTC{offsetLabel})";

        return $"Generated: {generatedAtLocal.ToString("MMMM d, yyyy h:mm tt", CultureInfo.InvariantCulture)} {timeZoneLabel}";
    }
}
