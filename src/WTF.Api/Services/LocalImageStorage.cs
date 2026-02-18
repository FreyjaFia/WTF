namespace WTF.Api.Services;

public class LocalImageStorage(IWebHostEnvironment env) : IImageStorage
{
    private readonly string _webRootPath = !string.IsNullOrWhiteSpace(env.WebRootPath)
        ? env.WebRootPath
        : Path.Combine(env.ContentRootPath, "wwwroot");

    public async Task<string> SaveAsync(string category, string fileName, byte[] data, CancellationToken cancellationToken)
    {
        var folderPath = Path.Combine(_webRootPath, "images", category);
        Directory.CreateDirectory(folderPath);

        var filePath = Path.Combine(folderPath, fileName);
        await File.WriteAllBytesAsync(filePath, data, cancellationToken);

        return $"/images/{category}/{fileName}";
    }

    public Task DeleteAsync(string? imageUrl, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(imageUrl))
        {
            return Task.CompletedTask;
        }

        var relativePath = ToRelativePath(imageUrl);
        if (string.IsNullOrWhiteSpace(relativePath) || !relativePath.StartsWith("images/", StringComparison.OrdinalIgnoreCase))
        {
            return Task.CompletedTask;
        }

        var fullPath = Path.Combine(_webRootPath, relativePath.Replace('/', Path.DirectorySeparatorChar));
        if (File.Exists(fullPath))
        {
            File.Delete(fullPath);
        }

        return Task.CompletedTask;
    }

    private static string ToRelativePath(string imageUrl)
    {
        if (Uri.TryCreate(imageUrl, UriKind.Absolute, out var absoluteUri))
        {
            return absoluteUri.AbsolutePath.TrimStart('/');
        }

        return imageUrl.TrimStart('/');
    }
}
