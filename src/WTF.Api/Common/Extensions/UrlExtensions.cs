using Microsoft.AspNetCore.Http;

namespace WTF.Api.Common.Extensions;

public static class UrlExtensions
{
    public static string? ToAbsoluteUrl(IHttpContextAccessor? httpContextAccessor, string? imageUrl)
    {
        if (string.IsNullOrWhiteSpace(imageUrl))
        {
            return null;
        }

        // If already absolute, return as-is
        if (Uri.TryCreate(imageUrl, UriKind.Absolute, out _))
        {
            return imageUrl;
        }

        var ctx = httpContextAccessor?.HttpContext;
        if (ctx == null)
        {
            // No request context available - return original relative value
            return imageUrl;
        }

        var baseUrl = $"{ctx.Request.Scheme}://{ctx.Request.Host}".TrimEnd('/');
        var clean = imageUrl.TrimStart('/');
        return $"{baseUrl}/{clean}";
    }
}
