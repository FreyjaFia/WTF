namespace WTF.Api.Services;

public class LocalImageStorage(IWebHostEnvironment env) : IImageStorage
{
    private readonly string _webRootPath = !string.IsNullOrWhiteSpace(env.WebRootPath)
        ? env.WebRootPath
        : Path.Combine(env.ContentRootPath, "wwwroot");

    public async Task<string> SaveAsync(string category, string fileName, byte[] data, CancellationToken cancellationToken)
    {
        var imagesRoot = Path.GetFullPath(Path.Combine(_webRootPath, "images"));
        var folderPath = Path.GetFullPath(Path.Combine(imagesRoot, category));
        if (string.IsNullOrWhiteSpace(fileName) || fileName != Path.GetFileName(fileName) || fileName.IndexOfAny(['/', '\\']) >= 0 || !IsUnder(imagesRoot, folderPath))
        {
            throw new ArgumentException("The image file name is not allowed.", nameof(fileName));
        }

        var filePath = Path.GetFullPath(Path.Combine(folderPath, fileName));
        if (!IsUnder(folderPath, filePath))
        {
            throw new ArgumentException("The image file name is not allowed.", nameof(fileName));
        }

        Directory.CreateDirectory(folderPath);
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

    public Task<IReadOnlyList<StoredImageInfo>> ListAsync(CancellationToken cancellationToken)
    {
        var root = Path.Combine(_webRootPath, "images");
        var files = new List<StoredImageInfo>();
        if (Directory.Exists(root))
        {
            foreach (var path in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
            {
                var key = "images/" + Path.GetRelativePath(root, path).Replace(Path.DirectorySeparatorChar, '/');
                files.Add(new StoredImageInfo(key, "/" + key, new DateTimeOffset(File.GetLastWriteTimeUtc(path), TimeSpan.Zero)));
            }
        }

        return Task.FromResult<IReadOnlyList<StoredImageInfo>>(files);
    }

    public string GetKey(string imageUrl) => ImageKey.From(imageUrl);

    private static bool IsUnder(string root, string path) =>
        path.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.Ordinal);

    private static string ToRelativePath(string imageUrl)
    {
        var key = ImageKey.From(imageUrl);
        return key.Contains("..", StringComparison.Ordinal) ? string.Empty : key;
    }
}
