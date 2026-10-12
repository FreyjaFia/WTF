namespace WTF.Api.Services;

/// <summary>
/// Turns any form a saved image URL can take into the storage key (<c>images/products/a.png</c>), so a database
/// value and a listed file compare equal: full URL or relative, %-encoded or not, forward or back slashes,
/// with or without the container name in front.
/// </summary>
public static class ImageKey
{
    private const string ImagesFolder = "images/";

    public static string From(string? imageUrl, string? containerName = null)
    {
        if (string.IsNullOrWhiteSpace(imageUrl))
        {
            return string.Empty;
        }

        var path = imageUrl.Trim().Replace('\\', '/');
        if (Uri.TryCreate(path, UriKind.Absolute, out var absolute) && absolute.Scheme is "http" or "https")
        {
            path = absolute.AbsolutePath;
        }

        try
        {
            path = Uri.UnescapeDataString(path);
        }
        catch (UriFormatException)
        {
            // keep the text as it is
        }

        path = path.Replace('\\', '/').Trim('/');
        while (path.Contains("//", StringComparison.Ordinal))
        {
            path = path.Replace("//", "/", StringComparison.Ordinal);
        }

        if (!string.IsNullOrEmpty(containerName)
            && path.StartsWith(containerName + "/", StringComparison.OrdinalIgnoreCase))
        {
            path = path[(containerName.Length + 1)..];
        }

        // Drop anything in front of the images folder (for example a path prefix added by a proxy).
        var index = path.StartsWith(ImagesFolder, StringComparison.OrdinalIgnoreCase)
            ? 0
            : path.IndexOf("/" + ImagesFolder, StringComparison.OrdinalIgnoreCase) + 1;
        return index > 0 ? path[index..] : path;
    }

    /// <summary>The file name alone, lower case. Saved names end in a random GUID, so this is unique and a good second check.</summary>
    public static string FileName(string? imageUrl)
    {
        var key = From(imageUrl);
        return key[(key.LastIndexOf('/') + 1)..].ToLowerInvariant();
    }
}
