using Microsoft.AspNetCore.Http;

namespace WTF.Api.Common.Extensions;

public static class UrlExtensions
{
    /// <summary>
    /// Converts a relative image path (e.g. "/images/products/x.png") to an absolute URL using the current HTTP context.
    /// If the value is already an absolute URL it is returned unchanged.
    /// If HttpContext is not available, returns the original value.
    /// </summary>
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
